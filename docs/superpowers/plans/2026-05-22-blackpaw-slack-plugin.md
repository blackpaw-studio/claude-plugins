# blackpaw-slack Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an alerting-minimal `blackpaw-slack` Claude Code channel plugin — a Slack bridge that lets a leo agent post into a Slack thread and receive that thread's replies — by adapting `blackpaw-telegram` and swapping its platform layer from Telegram/grammy to Slack/Bolt over Socket Mode.

**Architecture:** Reuse blackpaw-telegram's hardened core verbatim — the Claude Code channel contract (`notifications/claude/channel` notifications + `experimental: { 'claude/channel': {} }` capability), the singleton-instance lock/promotion/shutdown lifecycle, and `chunk()`. Replace the Telegram platform layer (grammy `Bot`, long-poll `getUpdates`, Bot API send calls, `chat_id`/`message_thread_id` IDs) with Slack (`@slack/bolt` `App` in Socket Mode, `message`/`app_mention` events, Web API `chat.postMessage`/`chat.update`/`reactions.add`, `channel`/`thread_ts` IDs). Drop everything not needed for the incident loop: voice/TTS, scheduler, document ingest, attachment download, history SQLite, and complex pairing.

**Tech Stack:** Bun + TypeScript, `@modelcontextprotocol/sdk`, `@slack/bolt` (Socket Mode + Web API). The editable repo is `/Users/evan/.leo/agents/claude-plugins` (this *is* the registered `blackpaw-plugins` marketplace — local edits are picked up on reinstall). The Slack app is **Olympus Alerts** (`app_id A0B5J0MLBKM`); creds in 1Password Olympus vault item "Olympus Alerts Slack App".

> **Working-dir note:** the shell resets cwd to `/Users/evan/.leo/agents/olympus` each command. Use absolute paths or `cd /Users/evan/.leo/agents/claude-plugins && …` in every command. Branch: `feat/blackpaw-slack`.

---

## What to KEEP from blackpaw-telegram (copy ~verbatim)

These modules are platform-agnostic or near-so — copy and keep:
- The **channel contract**: the `Server` construction with `capabilities.experimental['claude/channel']`, and every `notification({ method: 'notifications/claude/channel', params: { content, meta } })` emission. **This is the load-bearing contract — reproduce its shape exactly.**
- `src/lock.ts` (flock singleton), `src/sessionMarker.ts`, and the lifecycle functions in `server.ts`: `startPollerBackground` (rename to `startSocketBackground`), `shutdown`, the promotion `setInterval`, `liveParentPid()` orphan watchdog. The *transport* inside changes (Socket Mode connect instead of `bot.start()`), but the singleton/promotion/orphan logic stays.
- `chunk()` (adjust limit constant only).
- `bin/permission-bridge` + `hooks/hooks.json` (PermissionRequest → Slack approval). Keep the mechanism; swap the Telegram send for a Slack `chat.postMessage` with buttons (or, for minimal v1, a plain message + text reply — see Task 7).
- `skills/configure` and `skills/access` scaffolding (rewritten for Slack tokens — Task 6/7).

## What to DROP (do not port)
`src/tts/`, `src/transcription/`, `src/schedule/`, `src/documents/`, `src/history/`, and the tools `voice_reply`, `schedule`/`list_schedules`/`cancel_schedule`, `get_history`/`search_messages`, `download_attachment`. Also drop forward-batching (`src/threading/forwardBatch.ts`) — Slack has no forward bursts.

## What to SWAP (Telegram → Slack)
| Telegram (grammy) | Slack (@slack/bolt) |
|---|---|
| `new Bot(TELEGRAM_BOT_TOKEN)` | `new App({ token: SLACK_BOT_TOKEN, appToken: SLACK_APP_TOKEN, socketMode: true })` |
| `bot.start()` long-poll | `app.start()` (opens Socket Mode WebSocket) |
| `bot.on('message:text', …)` | `app.message(…)` and `app.event('app_mention', …)` |
| `ctx.api.sendMessage(chat_id, text, {message_thread_id})` | `client.chat.postMessage({ channel, thread_ts, text })` |
| `ctx.api.editMessageText` | `client.chat.update({ channel, ts, text })` |
| `ctx.api.setMessageReaction` | `client.reactions.add({ channel, timestamp, name })` |
| `chat_id`, `message_id`, `message_thread_id` | `channel`, `ts`, `thread_ts` |
| `reply_to_message` single-level walk | native `thread_ts` (Slack threads are first-class — no SQLite walk) |
| BotFather token | `SLACK_BOT_TOKEN` (`xoxb-`) + `SLACK_APP_TOKEN` (`xapp-`) |
| 4096 char chunk | 3000 char chunk (Slack practical block-text limit) |

## File structure (target)
```
plugins/blackpaw-slack/
├── .claude-plugin/plugin.json      # name=blackpaw-slack, version 0.1.0
├── .mcp.json                       # registers stdio MCP server "blackpaw-slack"
├── hooks/hooks.json                # PermissionRequest → bin/permission-bridge
├── bin/permission-bridge           # Slack-adapted approval bridge
├── package.json                    # deps: @modelcontextprotocol/sdk, @slack/bolt
├── tsconfig.json                   # copied
├── server.ts                       # adapted platform layer (the bulk of the work)
├── src/
│   ├── lock.ts                     # copied verbatim
│   ├── sessionMarker.ts            # copied verbatim
│   ├── channel.ts                  # NEW: extracted channel-notification helper (emit())
│   ├── slack.ts                    # NEW: thin Web API wrappers (post/update/react)
│   ├── access.ts                   # NEW: minimal channel allowlist gate
│   └── chunk.ts                    # extracted chunk() (was inline in server.ts)
├── skills/configure/SKILL.md       # Slack token + Socket Mode setup
└── README.md, LICENSE, NOTICE
```
State dir: `~/.claude/channels/blackpaw-slack/` (`.env` chmod 600, `access.json`, `run/`, `app.pid`, `server.log`).

---

## Task 0: Slack app — enable Socket Mode + app-level token (PREREQUISITE, partly interactive)

Socket Mode requires (a) Socket Mode enabled on the app, (b) bot event subscriptions, and (c) an **app-level token** (`xapp-`) with `connections:write`. The app config token can do (a) and (b) via `apps.manifest.update`; (c) is generated in the Slack UI (no public API mints app-level tokens).

- [ ] **Step 1: Update the app manifest to enable Socket Mode + event subscriptions**

Rotate the config token if stale (`tooling.tokens.rotate`), then `apps.manifest.update` for `app_id=A0B5J0MLBKM` with `settings.socket_mode_enabled: true`, `settings.event_subscriptions.bot_events: ["message.channels","app_mention"]`, `settings.interactivity.is_enabled: true`, and the existing bot scopes (add `reactions:read` if not present). Use the access token from the 1Password "Slack App Config Token" item. Confirm `ok:true, permissions_updated`. (If new scopes were added, the app must be reinstalled — Step 3.)

- [ ] **Step 2 (operator, interactive): Generate the app-level token**

In api.slack.com/apps/A0B5J0MLBKM → **Basic Information → App-Level Tokens → Generate Token and Scopes** → add scope `connections:write` → name it `socket` → copy the `xapp-…` token. Store it in the 1Password "Olympus Alerts Slack App" item field `app_token`. (This step cannot be automated; surface it to the operator and wait.)

- [ ] **Step 3 (operator, interactive): Reinstall the app if scopes changed**

If Step 1 added scopes, reinstall (api.slack.com/apps/A0B5J0MLBKM → Install App → Reinstall) and confirm the bot token is unchanged (or update 1Password `bot_token`).

- [ ] **Step 4: Invite the bot to #alerts**

In Slack: `/invite @olympusalerts` in `#alerts`. Required so the bot receives `message.channels` events for that channel and can read thread replies. Verify with `conversations.info`/`conversations.members` (bot `U0B5QBU75QS` present).

---

## Task 1: Scaffold blackpaw-slack from blackpaw-telegram

**Files:** create `plugins/blackpaw-slack/` (copy), edit `.claude-plugin/marketplace.json`.

- [ ] **Step 1: Copy the plugin tree, excluding node_modules and dropped modules**

```bash
cd /Users/evan/.leo/agents/claude-plugins
cp -R plugins/blackpaw-telegram plugins/blackpaw-slack
rm -rf plugins/blackpaw-slack/node_modules plugins/blackpaw-slack/bun.lock
rm -rf plugins/blackpaw-slack/src/tts plugins/blackpaw-slack/src/transcription \
       plugins/blackpaw-slack/src/schedule plugins/blackpaw-slack/src/documents \
       plugins/blackpaw-slack/src/history plugins/blackpaw-slack/src/threading
```
(Note: `cp`/`rm -rf` here operate only on the brand-new copied tree — safe. Do not touch `plugins/blackpaw-telegram`.)

- [ ] **Step 2: Update `plugins/blackpaw-slack/.claude-plugin/plugin.json`**

Set `name: "blackpaw-slack"`, `version: "0.1.0"`, description "Slack channel for Claude Code — alerting-minimal incident bridge (post to thread, receive thread replies) over Socket Mode.", keywords `["slack","messaging","channel","mcp","alerting"]`. Keep author/license.

- [ ] **Step 3: Register in `.claude-plugin/marketplace.json`**

Add a `blackpaw-slack` entry mirroring the `blackpaw-telegram` entry's shape (source `./plugins/blackpaw-slack`, etc.). Verify JSON validity: `python3 -c "import json;json.load(open('.claude-plugin/marketplace.json'))"`.

- [ ] **Step 4: Commit the scaffold**

```bash
cd /Users/evan/.leo/agents/claude-plugins
git add plugins/blackpaw-slack .claude-plugin/marketplace.json
git commit -m "feat(slack): scaffold blackpaw-slack from blackpaw-telegram (drop voice/sched/docs/history)"
```

---

## Task 2: package.json + dependency swap

**Files:** `plugins/blackpaw-slack/package.json`

- [ ] **Step 1: Rewrite deps and scripts**

Replace `grammy`, `mammoth`, `pdf-parse` with `@slack/bolt` (which bundles `@slack/web-api` + Socket Mode). Keep `@modelcontextprotocol/sdk`. Keep `start` = `bun install --no-summary && bun server.ts`. Set `name: "blackpaw-slack"`.

- [ ] **Step 2: Install and confirm it resolves**

```bash
cd /Users/evan/.leo/agents/claude-plugins/plugins/blackpaw-slack && bun install 2>&1 | tail -5
```
Expected: clean install, `@slack/bolt` present in `node_modules`.

- [ ] **Step 3: Commit**

```bash
cd /Users/evan/.leo/agents/claude-plugins
git add plugins/blackpaw-slack/package.json plugins/blackpaw-slack/bun.lock
git commit -m "feat(slack): swap deps to @slack/bolt"
```

---

## Task 3: Extract reusable helpers (channel.ts, chunk.ts) + copy lock/sessionMarker

**Files:** create `src/channel.ts`, `src/chunk.ts`; keep `src/lock.ts`, `src/sessionMarker.ts`.

- [ ] **Step 1: Extract `chunk()` into `src/chunk.ts`**

Move the `chunk(text, limit, mode)` function from the telegram `server.ts` into `src/chunk.ts`, exported. Default limit constant `3000`. Add a unit test `src/chunk.test.ts` (Bun test): asserts a 7000-char string splits into 3 chunks each ≤3000, and newline-mode splits on newlines. Run `bun test src/chunk.test.ts` → PASS.

- [ ] **Step 2: Create `src/channel.ts` — the channel-notification emitter**

Export `emitChannel(mcp, content: string, meta: Record<string,string>)` that calls `mcp.notification({ method: 'notifications/claude/channel', params: { content, meta } })`. `meta` keys for Slack: `source: "blackpaw-slack"`, `channel`, `thread_ts`, `ts`, `user`, `user_name`. This centralizes the contract so server.ts and the inbound handler share one definition. (Copy the exact param shape from telegram's emissions at server.ts:415/1031/1522.)

- [ ] **Step 3: Commit**

```bash
git add plugins/blackpaw-slack/src/chunk.ts plugins/blackpaw-slack/src/chunk.test.ts plugins/blackpaw-slack/src/channel.ts
git commit -m "feat(slack): extract chunk() + channel notification helper with tests"
```

---

## Task 4: src/slack.ts — Web API wrappers + ID mapping (TDD where pure)

**Files:** create `src/slack.ts`, `src/slack.test.ts`

- [ ] **Step 1: Write `src/slack.ts`**

Export thin async wrappers over a `WebClient`:
- `postMessage({ channel, thread_ts?, text })` → chunks `text` via `chunk()` at 3000; posts each chunk with `chat.postMessage` (first carries `thread_ts` if replying in-thread; subsequent chunks reuse the returned `thread_ts` to stay in-thread). Returns the first message `ts`.
- `updateMessage({ channel, ts, text })` → `chat.update`.
- `addReaction({ channel, ts, name })` → `reactions.add` (swallow `already_reacted`).
- Pure helper `normalizeThread(ev)`: given a Slack message event, return `{ channel, ts, thread_ts: ev.thread_ts ?? ev.ts }` — i.e. a top-level message starts its own thread; a threaded reply keeps its parent `thread_ts`.

- [ ] **Step 2: Unit-test the pure mapping**

`src/slack.test.ts`: `normalizeThread` returns `thread_ts === ts` for a top-level message (no `thread_ts`), and returns the parent `thread_ts` for a reply. Run `bun test src/slack.test.ts` → PASS. (The Web API calls themselves are covered by the live smoke test in Task 8, not mocked here.)

- [ ] **Step 3: Commit**

```bash
git add plugins/blackpaw-slack/src/slack.ts plugins/blackpaw-slack/src/slack.test.ts
git commit -m "feat(slack): web API wrappers + thread normalization with tests"
```

---

## Task 5: src/access.ts — minimal channel allowlist gate

**Files:** create `src/access.ts`, `src/access.test.ts`

- [ ] **Step 1: Write the gate**

Minimal model (no pairing flow): an allowlist of channel IDs in `~/.claude/channels/blackpaw-slack/access.json` (`{ "channels": ["C0AHFESPVH6"], "mode": "allowlist" }`), plus env override `SLACK_ALLOWED_CHANNELS` (comma-separated). Export `isAllowedChannel(channel: string): boolean` and `loadAccess()/saveAccess()`. Default-deny if the file is missing AND env unset (log a clear warning telling the operator to run the configure skill). Bot's own messages (`bot_id` present, or `user === SELF_BOT_USER_ID`) are always ignored to prevent loops.

- [ ] **Step 2: Test**

`src/access.test.ts`: allowed channel returns true; non-allowlisted returns false; env override parses; self-authored messages are rejected by the `isSelf()` helper. `bun test src/access.test.ts` → PASS.

- [ ] **Step 3: Commit**

```bash
git add plugins/blackpaw-slack/src/access.ts plugins/blackpaw-slack/src/access.test.ts
git commit -m "feat(slack): minimal channel-allowlist access gate with tests"
```

---

## Task 6: server.ts — the platform layer (the core adaptation)

**Files:** rewrite `plugins/blackpaw-slack/server.ts`

This is the bulk. Build it in sub-steps, type-checking after each. There is no clean unit-test seam for the Socket Mode loop — correctness is verified by `tsc` + the live smoke test (Task 8). Keep the file focused; lifecycle/lock logic is copied, only the transport + tools change.

- [ ] **Step 1: Config + env**

Replace the Telegram env block with: `SLACK_BOT_TOKEN` (xoxb, required), `SLACK_APP_TOKEN` (xapp, required for Socket Mode), read from `~/.claude/channels/blackpaw-slack/.env`. Construct `const app = new App({ token, appToken, socketMode: true, logLevel })` and `const client = app.client`. Resolve and cache `SELF_BOT_USER_ID` via `auth.test` at startup (for loop prevention).

- [ ] **Step 2: MCP server + capability + tool registration**

Construct the `Server` with `capabilities: { experimental: { 'claude/channel': {} }, tools: {} }` (copy from telegram server.ts:500). Register exactly four tools in the `tools/list` + `tools/call` handlers:
- `reply` — args `{ channel, thread_ts?, text }` → `postMessage`. (Drop telegram's `files`/`format`/`reply_to`.)
- `react` — args `{ channel, ts, name }` → `addReaction`.
- `edit_message` — args `{ channel, ts, text }` → `updateMessage`.
- `set_status` — optional convenience: `{ channel, ts, emoji }` shorthand for react (👀 working / ✅ done). (Include only if trivial; else skip.)
Each returns a small JSON result `{ ok, ts }`. Reuse `chunk()` inside `postMessage`.

- [ ] **Step 3: Inbound — Socket Mode event handlers → channel notification**

Register `app.message(async ({ message }) => …)` and `app.event('app_mention', …)`. Handler logic:
1. Ignore if `isSelf(message)` or `message.subtype` is a bot/system subtype.
2. `if (!isAllowedChannel(message.channel)) return;`
3. `const { channel, ts, thread_ts } = normalizeThread(message)`.
4. `emitChannel(mcp, message.text, { source:'blackpaw-slack', channel, thread_ts, ts, user: message.user, user_name: <resolve via users.info, cached> })`.
This is the inbound path that lets a user's thread reply reach the bound leo agent. (Mirror telegram's `handleInbound` at server.ts:1431 → emission at :1522.)

- [ ] **Step 4: Lifecycle — singleton Socket Mode connection**

Port `startPollerBackground` → `startSocketBackground`: only the flock lock winner calls `await app.start()` (opens the WebSocket); losers are send-only (tools still work via `client`, no socket). Keep the promotion `setInterval` (a send-only instance acquires the lock and starts the socket when the holder dies) and `shutdown()` (call `app.stop()`). Keep `liveParentPid()` orphan watchdog. Use `app.pid` lockfile under the blackpaw-slack state dir.

- [ ] **Step 5: Type-check**

```bash
cd /Users/evan/.leo/agents/claude-plugins/plugins/blackpaw-slack && bunx tsc --noEmit 2>&1 | tail -20
```
Expected: no type errors. Fix until clean.

- [ ] **Step 6: Commit**

```bash
git add plugins/blackpaw-slack/server.ts
git commit -m "feat(slack): Socket Mode platform layer — reply/react/edit tools + thread-reply inbound"
```

---

## Task 7: .mcp.json, hooks, permission-bridge, configure skill

**Files:** `.mcp.json`, `hooks/hooks.json`, `bin/permission-bridge`, `skills/configure/SKILL.md`

- [ ] **Step 1: `.mcp.json`** — rename the server to `blackpaw-slack`, keep the `bun run --cwd ${CLAUDE_PLUGIN_ROOT} start` launch. Verify JSON valid.

- [ ] **Step 2: `bin/permission-bridge`** — adapt the Telegram approval send to `chat.postMessage` (plain text: "Approve <tool>? reply 'yes'/'no' in this thread"), reading the reply from the same thread. For v1-minimal, a plain text approve/deny in-thread is acceptable (Block Kit buttons are a later enhancement). If this is more than a small change, stub it to auto-approve-with-log and note as DONE_WITH_CONCERNS — the incident agent runs under bypassPermissions anyway (the guardrail is the PreToolUse destructive-command hook in Plan 3, not this bridge).

- [ ] **Step 3: `skills/configure/SKILL.md`** — rewrite for Slack: how to get `SLACK_BOT_TOKEN`/`SLACK_APP_TOKEN` (point at 1Password "Olympus Alerts Slack App"), write them to `~/.claude/channels/blackpaw-slack/.env` (chmod 600), set the channel allowlist, and the `/invite @olympusalerts` requirement. Drop the telegram pairing flow.

- [ ] **Step 4: Remove `skills/access`** if it only covered telegram pairing (the minimal allowlist replaces it), or trim it to the allowlist model.

- [ ] **Step 5: Commit**

```bash
git add -A plugins/blackpaw-slack
git commit -m "feat(slack): mcp config, permission bridge, configure skill"
```

---

## Task 8: Live smoke test against Olympus Alerts + #alerts

**Files:** none (verification).

- [ ] **Step 1: Write the local `.env`**

```bash
mkdir -p ~/.claude/channels/blackpaw-slack
op item get "Olympus Alerts Slack App" --vault Olympus --fields bot_token --reveal  # → SLACK_BOT_TOKEN
op item get "Olympus Alerts Slack App" --vault Olympus --fields app_token --reveal  # → SLACK_APP_TOKEN
# write both to ~/.claude/channels/blackpaw-slack/.env, chmod 600
echo '{"channels":["C0AHFESPVH6"],"mode":"allowlist"}' > ~/.claude/channels/blackpaw-slack/access.json
```

- [ ] **Step 2: Boot the server standalone and confirm Socket Mode connects**

```bash
cd /Users/evan/.leo/agents/claude-plugins/plugins/blackpaw-slack && timeout 20 bun server.ts 2>&1 | tail -20
```
Expected: log shows `auth.test` success (bot `olympusalerts`), flock acquired, Socket Mode connected (`app.start()` ok), no crash.

- [ ] **Step 3: Inbound smoke — post in #alerts, confirm a channel notification is emitted**

With the server running, post a message in `#alerts` (or a thread). Confirm `server.log` shows the inbound message passing the gate and an emitted `notifications/claude/channel`. (Manually inspect the log line; the notification reaches a real Claude session only when launched via leo with this plugin — that integration is Plan 3.)

- [ ] **Step 4: Outbound smoke — exercise the reply tool**

Use a minimal MCP stdio client (or `bun` snippet calling the tool handler) to invoke `reply { channel: "C0AHFESPVH6", text: "blackpaw-slack outbound test" }`; confirm it lands in `#alerts`. Then `reply` with a `thread_ts` and confirm it threads. **Loop-safety check:** confirm this bot-authored message does NOT produce an inbound channel notification (isSelf must reject it).

- [ ] **Step 5: Install via marketplace + verify Claude Code loads it**

```bash
# The marketplace already points at this clone; reinstall to pick up the new plugin
claude plugin install blackpaw-slack@blackpaw-plugins 2>&1 | tail -5   # or the project's install path
```
Confirm the plugin loads (its MCP server starts, `reply`/`react`/`edit_message` tools appear).

- [ ] **Step 6: Commit any fixes, then open a PR**

```bash
cd /Users/evan/.leo/agents/claude-plugins
git push -u origin feat/blackpaw-slack
gh pr create --title "feat: blackpaw-slack channel plugin (alerting-minimal)" --body "<summary>"
```

---

## Self-review notes
- **Scope:** alerting-minimal per decision — reply/react/edit + thread-reply inbound + Socket Mode + minimal allowlist. Dropped voice/sched/docs/history/pairing. Parity features are a documented later follow-up.
- **Interactive dependencies (Task 0):** app-level token generation and reinstall/invite cannot be automated — surface to the operator and block on them before Task 8.
- **No clean unit seam for the socket loop:** pure logic (chunk, normalizeThread, access) is unit-tested; the transport + tools are verified by tsc + live smoke (Tasks 2/6/8). This is appropriate for an I/O-bound adaptation.
- **Plan 3 dependency:** this plugin is consumed by Plan 3 (incident-router spawns a leo agent bound to `blackpaw-slack(channel=#alerts, thread_ts=…)`). The `meta` keys emitted in Task 3/6 (`channel`, `thread_ts`) are the join key the router/agent use — keep them stable.
- **Loop-safety:** `isSelf()` (Task 5) must reject the bot's own posts, or the agent's replies would re-trigger inbound. Verify in Task 8 Step 4.
