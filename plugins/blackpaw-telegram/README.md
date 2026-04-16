# Telegram

Connect a Telegram bot to your Claude Code with an MCP server.

The MCP server logs into Telegram as a bot and provides tools to Claude to reply, react, or edit messages. When you message the bot, the server forwards the message to your Claude Code session.

> This is the Blackpaw Studio fork of Anthropic's official Telegram channel plugin. It is a superset of the upstream plugin — every upstream feature still works the same way, plus the additions listed below. Inspired by the non-daemon portions of [claude-telegram-supercharged](https://github.com/k1p1l0/claude-telegram-supercharged); see [NOTICE](./NOTICE) for attribution.

## What this fork adds

Beyond the upstream `reply` / `react` / `edit_message` / `download_attachment` toolset and basic DM pairing, this fork ships:

- **Voice transcription** — voice notes and audio files arrive as text. Provider chain (Groq → Deepgram → OpenAI → local `whisper-cli`) auto-skips providers without credentials.
- **Document ingest** — PDF, DOCX, CSV, TXT, JSON, LOG, MD attachments have their text extracted and inlined into the `<channel>` event.
- **`ask_user` tool** — inline-keyboard prompts (up to 12 choices) that block until the user taps one or `timeout_s` elapses.
- **`schedule` / `list_schedules` / `cancel_schedule` tools** — one-shot or recurring reminders persisted in SQLite. Missed reminders fire late on next launch.
- **`voice_reply` tool** — ElevenLabs-synthesized voice replies (registered only when `ELEVENLABS_API_KEY` is set).
- **SQLite history store** — every inbound and outbound message is persisted to `history.sqlite` with TTL/size pruning, exposed via `get_history` and `search_messages`.
- **Reply-chain threading** — when a user replies to an earlier message, the plugin walks the chain (default depth 3) and prepends a `[reply chain]` block so Claude has the thread context.
- **Forward-burst batching** — dumping 20+ forwards in 2 s collapses into a single summary event instead of flooding the session.
- **Router hint** — `TELEGRAM_ROUTER_MODEL` env surfaces routing guidance in the MCP instructions so Claude stays on the right model and knows when to escalate.
- **Forum Topics support** — inbound `message_thread_id` is preserved and `reply` accepts it, so the bot can participate in topic-organized supergroups without cross-topic leaks.
- **Typing indicator** — Telegram shows "botname is typing…" automatically while the assistant works on a response (forum-topic-aware).

Each is detailed below.

## Prerequisites

- [Bun](https://bun.sh) — the MCP server runs on Bun. Install with `curl -fsSL https://bun.sh/install | bash`.

## Quick Setup
> Default pairing flow for a single-user DM bot. See [ACCESS.md](./ACCESS.md) for groups and multi-user setups.

**1. Create a bot with BotFather.**

Open a chat with [@BotFather](https://t.me/BotFather) on Telegram and send `/newbot`. BotFather asks for two things:

- **Name** — the display name shown in chat headers (anything, can contain spaces)
- **Username** — a unique handle ending in `bot` (e.g. `my_assistant_bot`). This becomes your bot's link: `t.me/my_assistant_bot`.

BotFather replies with a token that looks like `123456789:AAHfiqksKZ8...` — that's the whole token, copy it including the leading number and colon.

**2. Install the plugin.**

These are Claude Code commands — run `claude` to start a session first.

Install the plugin:
```
/plugin marketplace add blackpaw-studio/claude-plugins
/plugin install blackpaw-telegram@blackpaw-plugins
/reload-plugins
```

**3. Give the server the token.**

```
/blackpaw-telegram:configure 123456789:AAHfiqksKZ8...
```

Writes `TELEGRAM_BOT_TOKEN=...` to `~/.claude/channels/blackpaw-telegram/.env`. You can also write that file by hand, or set the variable in your shell environment — shell takes precedence.

> To run multiple bots on one machine (different tokens, separate allowlists), point `TELEGRAM_STATE_DIR` at a different directory per instance.

**4. Relaunch with the channel flag.**

The server won't connect without this — exit your session and start a new one:

```sh
claude --dangerously-load-development-channels plugin:blackpaw-telegram@blackpaw-plugins
```

**5. Pair.**

With Claude Code running from the previous step, DM your bot on Telegram — it replies with a 6-character pairing code. If the bot doesn't respond, make sure your session is running with `--channels`. In your Claude Code session:

```
/blackpaw-telegram:access pair <code>
```

Your next DM reaches the assistant.

> Unlike Discord, there's no server invite step — Telegram bots accept DMs immediately. Pairing handles the user-ID lookup so you never touch numeric IDs.

**6. Lock it down.**

Pairing is for capturing IDs. Once you're in, switch to `allowlist` so strangers don't get pairing-code replies. Ask Claude to do it, or `/blackpaw-telegram:access policy allowlist` directly.

## Access control

See **[ACCESS.md](./ACCESS.md)** for DM policies, groups, mention detection, delivery config, skill commands, and the `access.json` schema.

Quick reference: IDs are **numeric user IDs** (get yours from [@userinfobot](https://t.me/userinfobot)). Default policy is `pairing`. `ackReaction` only accepts Telegram's fixed emoji whitelist.

## Tools exposed to the assistant

Tools marked ★ are added by this fork; the rest mirror the upstream plugin.

| Tool | Purpose |
| --- | --- |
| `reply` | Send to a chat. Takes `chat_id` + `text`, optionally `reply_to` (message ID) for native threading, `message_thread_id` for Forum Topics, and `files` (absolute paths) for attachments. Images (`.jpg`/`.png`/`.gif`/`.webp`) send as photos with inline preview; other types send as documents. Max 50MB each. Auto-chunks text; files send as separate messages after the text. Returns the sent message ID(s). |
| `react` | Add an emoji reaction to a message by ID. **Only Telegram's fixed whitelist** is accepted (👍 👎 ❤ 🔥 👀 etc). |
| `edit_message` | Edit a message the bot previously sent. Useful for "working…" → result progress updates. Only works on the bot's own messages. |
| `download_attachment` | Fetch a file by `attachment_file_id` (from inbound meta) into the inbox. Returns the local path, capped at Telegram's 20 MB bot-download limit. |
| `ask_user` ★ | Post a question with up to 12 inline-keyboard choices and block until the user taps one (or the `timeout_s` elapses, default 5 min). Returns `{value, label, timed_out, asked_message_id}`. |
| `get_history` ★ | Fetch recent messages for a chat from the local SQLite store (inbound + outbound). `before_ts` paginates. Oldest first. |
| `search_messages` ★ | Case-insensitive substring search over the local store. |
| `schedule` ★ | Create a reminder (`once` or `recurring`). At fire time the plugin sends a Telegram message and emits a `<channel>` event so Claude can follow up. Reminders fire only while Claude Code is running — missed ones fire late on next launch. |
| `list_schedules` / `cancel_schedule` ★ | Inspect and cancel pending reminders. |
| `voice_reply` ★ | Reply with an ElevenLabs-synthesized voice message (audio bubble). **Only registered when `ELEVENLABS_API_KEY` is set.** |

Inbound messages trigger a typing indicator automatically — Telegram shows
"botname is typing…" while the assistant works on a response.

## Photos

Inbound photos are downloaded to `~/.claude/channels/blackpaw-telegram/inbox/` and the
local path is included in the `<channel>` notification so the assistant can
`Read` it. Telegram compresses photos — if you need the original file, send it
as a document instead (long-press → Send as File).

## Voice transcription

Voice notes and audio files are transcribed and delivered as regular text
events — the `<channel>` content becomes the transcription, with the audio
file path and provider preserved in meta. Providers try in env-configurable
order (default `groq,deepgram,openai,local` — hosted first for latency;
`local` means `whisper-cli`). A provider is skipped when its API key / binary
is absent, so the chain gracefully handles partial configuration.

| Env var | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Groq Whisper (≈800 ms). |
| `DEEPGRAM_API_KEY` | Deepgram Nova-3 (≈1 s). |
| `OPENAI_API_KEY` | OpenAI Whisper-1 (≈2 s). |
| `TELEGRAM_WHISPER_CLI_PATH` / `TELEGRAM_WHISPER_MODEL` / `TELEGRAM_WHISPER_LANG` | Local `whisper-cli` (offline, slow). |
| `TELEGRAM_TRANSCRIBE_ORDER` | Override provider order, e.g. `groq,local`. |

## Document ingest

Documents ≤ `TELEGRAM_DOC_MAX_BYTES` (default 10 MB) have their text extracted
and appended to the inbound event content. Supported formats:

| Format | Extractor |
| --- | --- |
| PDF | `pdf-parse` |
| DOCX | `mammoth` |
| CSV / TXT / JSON / LOG / MD | direct |

Extracted text is clamped at 20 000 chars to protect the session token budget.

## History

The plugin writes inbound and outbound messages to
`~/.claude/channels/blackpaw-telegram/history.sqlite` (`bun:sqlite`, single file).
Retention is env-tunable:

| Env var | Default |
| --- | --- |
| `TELEGRAM_HISTORY_MAX_PER_CHAT` | 500 |
| `TELEGRAM_HISTORY_TTL_DAYS` | 14 |
| `TELEGRAM_HISTORY_MAX_BYTES` | 50 MB |

The pruner runs at boot and every 6 hours.

## Reminders (`schedule`)

Claude can schedule reminders that fire later in the same chat. Rows live in
`~/.claude/channels/blackpaw-telegram/schedule.sqlite`. Because there is no daemon,
the runner only fires while Claude Code is running — reminders whose
`fire_at` passed while the plugin was offline fire on next launch with
`fired_late: true`.

## Reply-chain threading

When an inbound message replies to an earlier one, the plugin walks up the
chain in the history store (up to `TELEGRAM_THREAD_DEPTH`, default 3) and
prepends a `[reply chain]` block so Claude sees the context of the thread.

## Forward-burst batching

Dumping a stack of forwards (articles, receipts, screenshots) no longer
floods the session. The plugin buffers forwards per chat and emits a single
summary event once the burst hits `TELEGRAM_FORWARD_MIN` (default 20) inside
`TELEGRAM_FORWARD_WINDOW_MS` (default 2 s).

## Router hint

Set `TELEGRAM_ROUTER_MODEL` to `sonnet` (default), `haiku`, or `opus`. The
plugin surfaces a routing hint in the MCP instructions so Claude stays on
the right model by default and knows when to escalate via `Agent(model:"opus")`.

## What's not here

- **Daemon/supervisor** — this fork deliberately excludes the
  auto-restart, context-watchdog, and 2-hour-uptime features from
  [claude-telegram-supercharged](https://github.com/k1p1l0/claude-telegram-supercharged).
- **Telegraph long-content publishing** — messages over 4096 chars chunk
  locally; no Instant View integration.
- **Sticker / GIF collages and video frame extraction** — stickers and
  videos still deliver as `attachment_file_id` meta; the plugin does not
  render them into image collages.
