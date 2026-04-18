/**
 * PermissionRequest approval bridge — MCP-server side.
 *
 * The `bin/permission-bridge` hook drops a request JSON file into RUN_DIR;
 * we watch that directory, DM the first paired approver with an inline
 * keyboard (Allow / Deny / Always / Deny & tell Claude), and write a
 * response JSON file that the hook picks up and returns to Claude Code.
 *
 * Callback namespace is `perm:<id>:<choice>` so it cannot collide with
 * askUser's `ask:<id>:<idx>` handler. Only user IDs in the provided
 * approverPool() can resolve a prompt — enforced on every callback.
 *
 * "Deny & tell Claude" issues a Telegram force_reply prompt and waits for
 * the next text message from the approver to use as the deny reason.
 */

import { readdirSync, readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { InlineKeyboard } from 'grammy'
import type { Bot } from 'grammy'

const POLL_MS = 300
const STALE_REQ_MS = 60 * 60 * 1000 // 1 hour — sweep abandoned prompts
const REASON_WAIT_MS = 120_000
const PREVIEW_LIMIT = 500

type ApproverPool = () => string[]

type RequestFile = {
  id: string
  created_at: number
  tool_name: string
  tool_input: unknown
  cwd: string
  session_id: string
}

type BridgeResponse = {
  decision: 'allow' | 'deny' | 'always'
  reason?: string
}

type PendingPrompt = {
  id: string
  req: RequestFile
  respPath: string
  approverChatId: string
  sentMessageId: number
  waitingReasonFromForceReplyId?: number
  reasonTimer?: Timer
}

const pending = new Map<string, PendingPrompt>()
const seen = new Set<string>()

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Authorization:\s*\S+/gi, 'Authorization: ***'],
  [/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer ***'],
  [/\bsk-[A-Za-z0-9_\-]{10,}/g, 'sk-***'],
  [/\bghp_[A-Za-z0-9]{10,}/g, 'ghp_***'],
  [/\bxoxb-[A-Za-z0-9\-]{10,}/g, 'xoxb-***'],
  [/\bAKIA[0-9A-Z]{10,}/g, 'AKIA***'],
  [/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, '(redacted private key)'],
  [/\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+/g, '(jwt ***)'],
  [/\bop:\/\/\S+/g, 'op://***'],
]

function redact(s: string): string {
  let out = s
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep)
  return out
}

function previewToolInput(input: unknown): string {
  let rendered: string
  try {
    rendered = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
  } catch {
    rendered = String(input)
  }
  rendered = redact(rendered)
  if (rendered.length > PREVIEW_LIMIT) {
    rendered = rendered.slice(0, PREVIEW_LIMIT) + `\n… (${rendered.length - PREVIEW_LIMIT} more chars)`
  }
  return rendered
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatPromptMessage(req: RequestFile): string {
  const tool = escapeHtml(req.tool_name || 'unknown tool')
  const cwd = escapeHtml(req.cwd || '')
  const preview = escapeHtml(previewToolInput(req.tool_input))
  const lines: string[] = []
  lines.push(`<b>Permission request:</b> <code>${tool}</code>`)
  if (cwd) lines.push(`<i>cwd:</i> <code>${cwd}</code>`)
  lines.push(`<pre>${preview}</pre>`)
  return lines.join('\n')
}

function buildKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Allow', `perm:${id}:allow`)
    .text('❌ Deny', `perm:${id}:deny`)
    .row()
    .text('🌟 Always allow', `perm:${id}:always`)
    .text('📝 Deny & tell Claude', `perm:${id}:reason`)
}

function writeResponse(respPath: string, body: BridgeResponse): void {
  const tmp = `${respPath}.tmp.${process.pid}`
  writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 })
  renameSync(tmp, respPath)
}

function logDecision(runDir: string, entry: Record<string, unknown>): void {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'
    // appendFileSync via import would be cleaner; keep deps minimal and reuse fs via writeFileSync w/ flag.
    const logPath = join(runDir, 'decisions.log')
    // Node accepts { flag: 'a' } for append on writeFileSync.
    writeFileSync(logPath, line, { flag: 'a', mode: 0o600 })
  } catch { /* decisions log is best-effort */ }
}

function logWatcher(runDir: string, kind: string, detail?: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${kind}${detail ? ' ' + detail : ''}\n`
    writeFileSync(join(runDir, 'watcher.log'), line, { flag: 'a', mode: 0o600 })
  } catch { /* best-effort */ }
}

function resolveResponse(
  prompt: PendingPrompt,
  body: BridgeResponse,
  runDir: string,
  approverId: string,
): void {
  writeResponse(prompt.respPath, body)
  logDecision(runDir, {
    prompt_id: prompt.id,
    tool: prompt.req.tool_name,
    decision: body.decision,
    reason: body.reason,
    approver: approverId,
  })
  pending.delete(prompt.id)
}

async function editOutcome(
  bot: Bot,
  prompt: PendingPrompt,
  outcome: string,
): Promise<void> {
  const body = `${formatPromptMessage(prompt.req)}\n\n<i>${escapeHtml(outcome)}</i>`
  await bot.api
    .editMessageText(prompt.approverChatId, prompt.sentMessageId, body, {
      parse_mode: 'HTML',
      reply_markup: undefined,
    })
    .catch(() => {})
}

function sweepStale(runDir: string): void {
  let files: string[] = []
  try { files = readdirSync(runDir) } catch { return }
  const now = Date.now()
  for (const f of files) {
    if (!/\.(req|resp)\.json$/.test(f)) continue
    const full = join(runDir, f)
    try {
      const st = statSync(full)
      if (now - st.mtimeMs > STALE_REQ_MS) rmSync(full, { force: true })
    } catch { /* ignore */ }
  }
}

/**
 * On MCP startup, any unpaired .req.json that predates the current process
 * corresponds to a hook that already timed out (the bridge polls for 5 min,
 * then Claude Code reaps it). The bridge can't observe a new response once
 * it's dead, so processing these would just spam Telegram with orphaned
 * approval messages. Delete them.
 */
function dropPreStartupRequests(runDir: string): void {
  let files: string[] = []
  try { files = readdirSync(runDir) } catch { return }
  let dropped = 0
  for (const f of files) {
    if (!f.endsWith('.req.json')) continue
    try {
      rmSync(join(runDir, f), { force: true })
      dropped++
    } catch { /* ignore */ }
  }
  if (dropped > 0) logWatcher(runDir, 'dropped-pre-startup', `count=${dropped}`)
}

async function processRequest(
  bot: Bot,
  runDir: string,
  req: RequestFile,
  approverPool: ApproverPool,
): Promise<void> {
  logWatcher(runDir, 'process', `id=${req.id} tool=${req.tool_name}`)
  const respPath = join(runDir, `${req.id}.resp.json`)
  let approvers: string[]
  try {
    approvers = approverPool()
  } catch (err) {
    logWatcher(runDir, 'approver-pool-error', (err as Error).message)
    writeResponse(respPath, { decision: 'deny', reason: 'approver pool unavailable' })
    return
  }
  const approverChatId = approvers[0]
  if (!approverChatId) {
    logWatcher(runDir, 'no-approver', `id=${req.id}`)
    writeResponse(respPath, { decision: 'deny', reason: 'no approver configured (blackpaw-telegram: pair a user first)' })
    return
  }

  try {
    logWatcher(runDir, 'sendMessage-start', `id=${req.id} chat=${approverChatId}`)
    const sent = await bot.api.sendMessage(approverChatId, formatPromptMessage(req), {
      parse_mode: 'HTML',
      reply_markup: buildKeyboard(req.id),
    })
    logWatcher(runDir, 'sendMessage-ok', `id=${req.id} msg=${sent.message_id}`)
    pending.set(req.id, {
      id: req.id,
      req,
      respPath,
      approverChatId,
      sentMessageId: sent.message_id,
    })
  } catch (err) {
    logWatcher(runDir, 'sendMessage-fail', `id=${req.id} err=${(err as Error).message}`)
    writeResponse(respPath, {
      decision: 'deny',
      reason: `blackpaw-telegram: failed to send approval message (${(err as Error).message})`,
    })
  }
}

export function startPermissionApproval(
  bot: Bot,
  runDir: string,
  approverPool: ApproverPool,
): void {
  mkdirSync(runDir, { recursive: true, mode: 0o700 })
  logWatcher(runDir, 'startup', `pid=${process.pid}`)
  sweepStale(runDir)
  dropPreStartupRequests(runDir)

  // Callback tap: perm:<id>:<choice>
  // Call next() on non-matches so other callback_query handlers (askUser)
  // stay reachable.
  bot.on('callback_query:data', async (ctx, next) => {
    const data = ctx.callbackQuery.data
    const m = /^perm:([a-f0-9\-]{8,}):(allow|deny|always|reason)$/.exec(data)
    if (!m) { await next(); return }
    const [, id, choice] = m
    logWatcher(runDir, 'callback', `id=${id} choice=${choice} from=${ctx.from?.id}`)
    const prompt = pending.get(id)
    if (!prompt) {
      logWatcher(runDir, 'callback-unknown-id', `id=${id}`)
      await ctx.answerCallbackQuery({ text: 'Already decided or expired.' }).catch(() => {})
      return
    }

    const approverId = String(ctx.from?.id ?? '')
    const approvers = approverPool()
    if (!approvers.includes(approverId)) {
      await ctx.answerCallbackQuery({ text: 'Not authorized.' }).catch(() => {})
      logDecision(runDir, {
        prompt_id: id,
        tool: prompt.req.tool_name,
        decision: 'unauthorized_tap',
        tap_from: approverId,
      })
      return
    }

    if (choice === 'reason') {
      // Send a force-reply prompt. Capture the approver's next message.
      await ctx.answerCallbackQuery({ text: 'Send the reason as a reply.' }).catch(() => {})
      try {
        const ask = await bot.api.sendMessage(
          prompt.approverChatId,
          'Reason for denying? Reply to this message.',
          {
            reply_parameters: { message_id: prompt.sentMessageId },
            reply_markup: { force_reply: true, input_field_placeholder: 'Reason…' },
          },
        )
        prompt.waitingReasonFromForceReplyId = ask.message_id
        prompt.reasonTimer = setTimeout(() => {
          if (!pending.has(prompt.id)) return
          resolveResponse(prompt, { decision: 'deny', reason: 'denied via Telegram (no reason given)' }, runDir, approverId)
          void editOutcome(bot, prompt, `❌ Denied by ${ctx.from?.first_name ?? 'approver'} (no reason)`)
        }, REASON_WAIT_MS)
      } catch {
        resolveResponse(prompt, { decision: 'deny', reason: 'denied via Telegram' }, runDir, approverId)
        await editOutcome(bot, prompt, `❌ Denied by ${ctx.from?.first_name ?? 'approver'}`)
      }
      return
    }

    await ctx.answerCallbackQuery({ text: `Recorded: ${choice}` }).catch(() => {})
    const who = ctx.from?.first_name ?? 'approver'
    if (choice === 'allow') {
      resolveResponse(prompt, { decision: 'allow' }, runDir, approverId)
      await editOutcome(bot, prompt, `✅ Allowed by ${who}`)
    } else if (choice === 'always') {
      resolveResponse(prompt, { decision: 'always' }, runDir, approverId)
      await editOutcome(bot, prompt, `🌟 Always allowed by ${who}`)
    } else {
      resolveResponse(prompt, { decision: 'deny', reason: 'denied via Telegram' }, runDir, approverId)
      await editOutcome(bot, prompt, `❌ Denied by ${who}`)
    }
  })

  // Catch the force-reply reason message.
  bot.on('message:text', async (ctx, next) => {
    const replyTo = ctx.message.reply_to_message?.message_id
    if (replyTo == null) { await next(); return }

    // Find the matching prompt (match by force-reply message_id AND chat).
    const approverId = String(ctx.from?.id ?? '')
    let matched: PendingPrompt | undefined
    for (const p of pending.values()) {
      if (
        p.waitingReasonFromForceReplyId === replyTo &&
        p.approverChatId === String(ctx.chat.id)
      ) {
        matched = p
        break
      }
    }
    if (!matched) { await next(); return }

    const approvers = approverPool()
    if (!approvers.includes(approverId)) { await next(); return }

    const reason = (ctx.message.text ?? '').slice(0, 500).trim() || 'denied via Telegram'
    if (matched.reasonTimer) clearTimeout(matched.reasonTimer)
    resolveResponse(matched, { decision: 'deny', reason }, runDir, approverId)
    await editOutcome(bot, matched, `❌ Denied by ${ctx.from?.first_name ?? 'approver'}: ${reason}`)
  })

  // Request-file watcher. Poll is simpler than fs.watch and matches approved/ pattern.
  let sweepTick = 0
  setInterval(() => {
    sweepTick++
    if (sweepTick % 60 === 0) sweepStale(runDir) // ~every 18s

    let files: string[]
    try { files = readdirSync(runDir) } catch { return }
    for (const f of files) {
      if (!f.endsWith('.req.json')) continue
      if (seen.has(f)) continue
      const full = join(runDir, f)
      let req: RequestFile
      try {
        req = JSON.parse(readFileSync(full, 'utf8')) as RequestFile
      } catch {
        // Malformed — remove so we don't keep retrying.
        try { rmSync(full, { force: true }) } catch { /* ignore */ }
        continue
      }
      seen.add(f)
      // If a response already exists from a previous process, skip (stale).
      if (existsSync(join(runDir, `${req.id}.resp.json`))) continue
      void processRequest(bot, runDir, req, approverPool)
    }
  }, POLL_MS)
}
