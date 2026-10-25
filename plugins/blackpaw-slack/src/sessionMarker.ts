/**
 * Session-scope marker for permission prompt routing.
 *
 * The plugin's MCP server is only started in Claude Code sessions that
 * explicitly loaded the plugin (via --dangerously-load-development-channels
 * or a normal /plugin install + enable). The PermissionRequest hook, on the
 * other hand, fires for every Claude Code session that has the plugin
 * installed — so without a filter, the poller broadcasts permission prompts
 * from unrelated sessions to Telegram.
 *
 * Fix: on startup the MCP server drops a marker file for each process in its
 * ancestor PID chain. On each hook invocation the bridge walks its own
 * ancestor chain and checks for any matching marker. Chains overlap at the
 * Claude Code process (their common ancestor), so a match means "this hook
 * is firing inside a plugin-loaded session." No match → bridge abstains and
 * Claude falls back to its default CLI permission prompt.
 *
 * PIDs are used rather than Claude Code's session_id because MCP servers
 * don't receive session_id over the MCP protocol — the process tree is the
 * only channel that both sides can observe.
 */

import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const MAX_ANCESTOR_DEPTH = 6

export function sessionsDir(runDir: string): string {
  return join(runDir, 'sessions')
}

function markerPath(runDir: string, pid: number): string {
  return join(sessionsDir(runDir), `${pid}.active`)
}

/**
 * Walk up to MAX_ANCESTOR_DEPTH parents from the current process. Stops at
 * init (pid 1), a self-loop, or any ps failure. Returns ancestor pids with
 * the immediate parent first.
 */
export function ancestorPids(): number[] {
  const pids: number[] = []
  let cur = process.ppid
  for (let i = 0; i < MAX_ANCESTOR_DEPTH && cur > 1; i++) {
    pids.push(cur)
    let next: number
    try {
      const out = execFileSync('ps', ['-o', 'ppid=', '-p', String(cur)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      next = parseInt(out, 10)
    } catch {
      break
    }
    if (!Number.isFinite(next) || next === cur || next <= 1) break
    cur = next
  }
  return pids
}

/**
 * Write a marker file for every ancestor pid. Returns the list of paths
 * written so the caller can clean them up on shutdown. Best-effort — any
 * individual write failure is swallowed and logged by the caller via
 * the returned path list vs. what actually got written.
 */
export function writeSessionMarkers(
  runDir: string,
  meta: { mcp_pid: number; role: 'poller' | 'send-only' },
): string[] {
  const dir = sessionsDir(runDir)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch {
    return []
  }
  const written: string[] = []
  const body = JSON.stringify({
    ...meta,
    started_at: Date.now(),
  })
  for (const pid of ancestorPids()) {
    const p = markerPath(runDir, pid)
    try {
      writeFileSync(p, body, { mode: 0o600 })
      written.push(p)
    } catch { /* best-effort */ }
  }
  return written
}

/**
 * Hook-side check: does any ancestor of the current process have an active
 * marker? This is the single predicate the permission-bridge uses to decide
 * whether to forward a permission request to Telegram.
 */
export function hookIsInPluginSession(runDir: string): { matched: boolean; claudePid?: number } {
  const dir = sessionsDir(runDir)
  for (const pid of ancestorPids()) {
    if (existsSync(join(dir, `${pid}.active`))) {
      return { matched: true, claudePid: pid }
    }
  }
  return { matched: false }
}

/**
 * Prune markers whose pid is no longer a live process. Called by the poller
 * on a low-frequency sweep; cheap because markers are tiny and rare.
 */
export function sweepStaleSessionMarkers(runDir: string): void {
  const dir = sessionsDir(runDir)
  let files: string[] = []
  try { files = readdirSync(dir) } catch { return }
  for (const f of files) {
    if (!f.endsWith('.active')) continue
    const pidStr = f.slice(0, -'.active'.length)
    const pid = parseInt(pidStr, 10)
    if (!Number.isFinite(pid) || pid <= 1) continue
    try {
      process.kill(pid, 0)
    } catch {
      try { rmSync(join(dir, f), { force: true }) } catch { /* ignore */ }
    }
  }
}
