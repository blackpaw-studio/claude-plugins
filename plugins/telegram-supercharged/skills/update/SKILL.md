---
name: update
description: Update the Telegram Supercharged plugin to the latest version from GitHub. Use when the statusline shows "⬆ Supercharged", or when the user says "update telegram plugin", "update supercharged", or "telegram:update".
---

# Update Telegram Supercharged Plugin

Pull the latest version from GitHub and apply it to the installed plugin.

## Process

### Step 1: Check current state

```bash
# Get local file hash
LOCAL_FILE="$HOME/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/telegram/server.ts"
LOCAL_HASH=$(shasum -a 256 "$LOCAL_FILE" 2>/dev/null | cut -c1-12)
echo "Local hash: $LOCAL_HASH"
```

### Step 2: Check for updates

```bash
# Read cache if available
cat ~/.claude/cache/telegram-update-check.json 2>/dev/null || echo '{"update_available":"unknown"}'
```

### Step 3: Pull latest from GitHub

If update is available (or unknown), pull the latest:

```bash
cd /tmp
if [ -d "claude-telegram-supercharged" ]; then
  cd claude-telegram-supercharged && git pull
else
  git clone https://github.com/k1p1l0/claude-telegram-supercharged.git
  cd claude-telegram-supercharged
fi
```

### Step 4: Compare versions

```bash
REMOTE_HASH=$(shasum -a 256 /tmp/claude-telegram-supercharged/server.ts 2>/dev/null | cut -c1-12)
echo "Remote hash: $REMOTE_HASH"
echo "Local hash: $LOCAL_HASH"
```

If hashes match, report "Already up to date" and exit.

### Step 5: Show what changed

```bash
cd /tmp/claude-telegram-supercharged && git log --oneline -10
```

Show the user the recent commits and ask for confirmation before updating.

### Step 6: Apply update

After user confirms:

```bash
PLUGIN_DIR="$HOME/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/telegram"

# Copy core files
cp /tmp/claude-telegram-supercharged/server.ts "$PLUGIN_DIR/server.ts"
cp /tmp/claude-telegram-supercharged/package.json "$PLUGIN_DIR/package.json"
cp /tmp/claude-telegram-supercharged/bun.lock "$PLUGIN_DIR/bun.lock"

# Copy skills
cp -r /tmp/claude-telegram-supercharged/skills/* "$PLUGIN_DIR/skills/"

# Copy supervisor
mkdir -p "$HOME/.claude/scripts"
cp /tmp/claude-telegram-supercharged/supervisor.ts "$HOME/.claude/scripts/telegram-supervisor.ts"

# Install dependencies
cd "$PLUGIN_DIR" && bun install --no-summary
```

### Step 7: Clear update cache

```bash
rm -f ~/.claude/cache/telegram-update-check.json
```

### Step 8: Report success

Display:
```
╔═══════════════════════════════════════════════════════════╗
║  Supercharged Updated!                                    ║
╚═══════════════════════════════════════════════════════════╝

⚠️  Restart the Telegram daemon to apply changes:
   /telegram:daemon restart

   Or write restart signal:
   echo "restart" > ~/.claude/channels/telegram/data/restart.signal
```

## Important Notes

- Always show the user what changed before applying
- Ask for confirmation before overwriting files
- Clear the update cache after successful update so the statusline indicator disappears
- Remind user to restart the daemon after updating
