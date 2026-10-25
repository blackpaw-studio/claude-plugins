---
name: configure
description: Set up the blackpaw-slack channel — save bot and app tokens, set the channel allowlist. Use when the user asks to configure Slack, asks "how do I set this up", wants to check channel status, or needs to update tokens.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(chmod *)
  - Bash(op item get *)
---

# /blackpaw-slack:configure — Slack Channel Setup

Writes credentials to `~/.claude/channels/blackpaw-slack/.env` and configures the
channel allowlist. The server reads both files at boot.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status and guidance

Read state files and give the user a complete picture:

1. **Tokens** — check `~/.claude/channels/blackpaw-slack/.env` for
   `SLACK_BOT_TOKEN` (xoxb-...) and `SLACK_APP_TOKEN` (xapp-...). Show
   set/not-set; if set, show first 12 chars + `...` masked.

2. **Channel allowlist** — read `~/.claude/channels/blackpaw-slack/access.json`
   (missing = not configured). Show mode and the channel list.

3. **What next** — end with a concrete next step:
   - No tokens → *"Run `/blackpaw-slack:configure tokens` to pull credentials from
     1Password."*
   - Tokens set, no allowlist → *"Run `/blackpaw-slack:configure allowlist` to set
     the default #alerts channel allowlist."*
   - Both configured → *"Ready. The bot will post to and receive replies from the
     allowed channels."*

### `tokens` — pull from 1Password and save

1. Retrieve the Slack app credentials from 1Password:
   ```bash
   op item get "Olympus Alerts Slack App" --vault Olympus --fields bot_token --reveal
   op item get "Olympus Alerts Slack App" --vault Olympus --fields app_token --reveal
   ```
2. `mkdir -p ~/.claude/channels/blackpaw-slack`
3. Write `~/.claude/channels/blackpaw-slack/.env` with:
   ```
   SLACK_BOT_TOKEN=<bot_token>
   SLACK_APP_TOKEN=<app_token>
   ```
   Read existing `.env` first if present; update/add those two lines, preserve
   any other keys. Write back, no quotes around values.
4. `chmod 600 ~/.claude/channels/blackpaw-slack/.env` — these are credentials.
5. Confirm, then show the no-args status so the user sees the full picture.

### `allowlist` — configure default #alerts channel

1. `mkdir -p ~/.claude/channels/blackpaw-slack`
2. Write `~/.claude/channels/blackpaw-slack/access.json`:
   ```json
   {
     "channels": ["C0AHFESPVH6"],
     "mode": "allowlist"
   }
   ```
   (`C0AHFESPVH6` = #alerts). If the file already exists, read it first and
   merge — update `channels` and `mode`, preserve any other keys.
3. Confirm with the channel ID and human name.

### `channel <channel-id>` — add a channel to the allowlist

1. Read `~/.claude/channels/blackpaw-slack/access.json` (create default if missing).
2. Add `<channel-id>` to `channels` (dedupe).
3. Write back, confirm.

### `clear` — remove tokens

Delete `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` lines from `.env` (or the file
if those are the only lines).

---

## Prerequisites (remind the user if tokens are missing)

The Slack app must be configured correctly before this plugin works:

- **Socket Mode enabled** — required for the `xapp-` app-level token.
- **App-level token scope** — the app token needs `connections:write`.
- **Bot invited to the channel** — in Slack: `/invite @olympusalerts` in #alerts
  (or whichever channel is in the allowlist).

The 1Password item "Olympus Alerts Slack App" (Olympus vault) holds:
- `bot_token` — `xoxb-...` OAuth bot token
- `app_token` — `xapp-...` app-level Socket Mode token

---

## Implementation notes

- The channels dir may not exist if the server hasn't run yet. Missing file =
  not configured, not an error.
- The server reads `.env` once at boot. Token changes need a session restart
  or `/reload-plugins`. Say so after saving.
- `access.json` is re-read on each message — allowlist changes take effect
  immediately without restart.
- Channel IDs are the `C...` identifiers, not `#channel-name` strings. The
  default Olympus alerts channel is `C0AHFESPVH6` (#alerts).
