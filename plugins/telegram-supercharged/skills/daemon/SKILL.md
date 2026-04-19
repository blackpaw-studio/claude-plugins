---
name: daemon
description: Manage the Telegram daemon lifecycle — start, stop, restart, check status, tail logs. Use when the user says "start the bot", "stop the daemon", "restart telegram", "daemon status", "show bot logs", or "is the bot running".
user-invocable: true
allowed-tools:
  - Bash(launchctl *)
  - Bash(ps *)
  - Bash(tail *)
  - Bash(cat *)
  - Bash(grep *)
  - Bash(strings *)
  - Bash(kill *)
  - Read
---

# /telegram-supercharged:daemon — Telegram Daemon Lifecycle Manager

Full lifecycle management for the Telegram bot daemon (launchd + supervisor + Claude).

## Arguments — dispatch on first word

### `start` (default if no args and daemon is not running)

Start the daemon via launchd:

```bash
launchctl load ~/Library/LaunchAgents/com.user.claude-telegram.plist 2>&1
```

If it fails with "already loaded", report that the daemon is already running.
After loading, wait 5 seconds, then run the status check to confirm it started.

### `stop`

Stop the daemon:

```bash
launchctl unload ~/Library/LaunchAgents/com.user.claude-telegram.plist 2>&1
```

Wait 3 seconds, verify all processes are gone:

```bash
ps aux | grep -E "channels.*telegram" | grep -v grep
```

Report success or if orphan processes remain.

### `restart`

Unload then load:

```bash
launchctl unload ~/Library/LaunchAgents/com.user.claude-telegram.plist 2>/dev/null
sleep 2
launchctl load ~/Library/LaunchAgents/com.user.claude-telegram.plist
```

Wait 10 seconds, then run full status check.

### `status` (default if no args and daemon IS running)

Run the full monitor check — same as /telegram-supercharged:monitor:

1. Process status (supervisor, expect, claude, MCP server, caffeinate)
2. Launchd loaded/not
3. Remote control URL
4. Lock file
5. Last 5 log lines

### `logs`

Tail the last 30 lines of supervisor stderr:

```bash
tail -30 ~/.claude/channels/telegram-supercharged/data/supervisor-stderr.log
```

### `stdout`

Tail the last 30 lines of daemon's Claude output:

```bash
tail -30 ~/.claude/channels/telegram-supercharged/data/supervisor-stdout.log
```

### `url`

Just show the remote control URL:

```bash
cat ~/.claude/channels/telegram-supercharged/data/supervisor-stdout.log | strings | grep "session_" | tail -1
```

### No args

Check if daemon is running. If running → show status. If not running → ask if user wants to start it.

## Important notes

- The `launchctl load/unload` commands may fail with "Input/output error" — this usually means the service is already in the requested state. Handle gracefully.
- After start/restart, always verify the daemon actually started by checking processes.
- The plist path is always: `~/Library/LaunchAgents/com.user.claude-telegram.plist`
- Show the remote control URL after every start/restart so the user can monitor.
