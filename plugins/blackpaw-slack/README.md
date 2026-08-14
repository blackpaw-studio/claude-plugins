# blackpaw-slack

Alerting-minimal Slack channel plugin for Claude Code. Posts to a Slack channel over Socket Mode and receives thread replies, bridging Slack into your Claude Code session via MCP.

> Adapted from the `blackpaw-telegram` plugin. The Socket Mode transport and alerting-focused toolset replace Telegram's polling bot model.

## What this does

- Posts messages and files to a configured Slack channel
- Receives thread replies back into the Claude Code session
- Runs over Slack's Socket Mode (no public webhook URL required)

## Prerequisites

- [Bun](https://bun.sh) — the MCP server runs on Bun
- A Slack app with Socket Mode enabled and an app-level token (`xapp-`) with the `connections:write` scope
- Bot token (`xoxb-`) with `chat:write` and relevant channel permissions
- Bot invited to the target channel (`/invite @olympusalerts` in #alerts)

Credentials live in 1Password — Olympus vault, item "Olympus Alerts Slack App".

## Quick Setup

Run these in a Claude Code session:

```
/plugin marketplace add blackpaw-studio/claude-plugins
/plugin install blackpaw-slack@blackpaw-plugins
/reload-plugins
```

Then configure:

```
/blackpaw-slack:configure tokens
/blackpaw-slack:configure allowlist
```

`tokens` pulls `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` from 1Password and writes
them to `~/.claude/channels/blackpaw-slack/.env`. `allowlist` sets the default
channel (`#alerts` = `C0AHFESPVH6`) in `~/.claude/channels/blackpaw-slack/access.json`.

See `/blackpaw-slack:configure` (no args) for current status at any time.
