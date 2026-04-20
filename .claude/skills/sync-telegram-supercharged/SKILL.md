---
name: sync-telegram-supercharged
description: Use when pulling updates from upstream k1p1l0/claude-telegram-supercharged into this marketplace's telegram-supercharged plugin. The fork has local rebrand patches (plugin rename, state-dir rename, slash-command namespace) that must be re-applied after every sync.
---

# Sync telegram-supercharged from upstream

This repo republishes [k1p1l0/claude-telegram-supercharged](https://github.com/k1p1l0/claude-telegram-supercharged) (Apache-2.0) under the plugin name `telegram-supercharged`. The upstream assumes it lives *as* the official Telegram plugin, so we apply a small set of deterministic renames on every sync.

Invoke this skill when the user says "sync telegram-supercharged", "pull upstream supercharged", "update the telegram plugin from upstream", or anything similar.

## What the sync does

1. Clone upstream `master` to a temp dir.
2. Mirror it into `plugins/telegram-supercharged/` — preserving our owned files (`.claude-plugin/plugin.json`, `NOTICE`).
3. Delete the upstream `skills/update/` skill (superseded by this one).
4. Apply the rebrand patches:
   - `channels/telegram` → `channels/telegram-supercharged` (state directory)
   - `plugin:telegram@claude-plugins-official` → `plugin:telegram-supercharged@blackpaw-plugins` (supervisor launch)
   - `/telegram:{access,configure,update,daemon,monitor,context,calendar}` → `/telegram-supercharged:$1` (slash commands)
5. Regenerate `plugins/telegram-supercharged/.claude-plugin/plugin.json` with upstream's `package.json` version.
6. Bump the marketplace entry in `.claude-plugin/marketplace.json` to the same version.

## Procedure

Run from the repo root. All commands should be presented to the user for approval before executing — no auto-push.

```bash
set -euo pipefail

UPSTREAM_REPO="https://github.com/k1p1l0/claude-telegram-supercharged.git"
UPSTREAM_REF="master"
PLUGIN_DIR="plugins/telegram-supercharged"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

git clone --depth 1 --branch "$UPSTREAM_REF" "$UPSTREAM_REPO" "$work_dir/src"
upstream_sha="$(git -C "$work_dir/src" rev-parse HEAD)"
upstream_version="$(jq -r '.version' "$work_dir/src/package.json")"

# Mirror upstream, preserving our owned files
rsync -a --delete \
  --exclude='.git' \
  --exclude='.github' \
  --exclude='.claude-plugin/' \
  --exclude='.mcp.json' \
  --exclude='.npmrc' \
  --exclude='NOTICE' \
  "$work_dir/src/" "$PLUGIN_DIR/"

# Drop the upstream update skill (this skill replaces it)
rm -rf "$PLUGIN_DIR/skills/update"

# Re-apply rebrand patches
find "$PLUGIN_DIR" -type f \( -name "*.ts" -o -name "*.md" -o -name "*.json" -o -name "*.exp" \) \
  ! -path "*/node_modules/*" -print0 | xargs -0 perl -i -pe '
    s#channels/telegram(?![-\w])#channels/telegram-supercharged#g;
    s#"channels"\s*,\s*"telegram"(?!-)#"channels", "telegram-supercharged"#g;
    s#plugin:telegram\@claude-plugins-official#plugin:telegram-supercharged\@blackpaw-plugins#g;
    s#(/telegram):(access|configure|update|daemon|monitor|context|calendar)\b#/telegram-supercharged:$2#g;
  '

# Patch: ensure DATA_DIR exists before acquireLock writes the lock file.
# Upstream only mkdirs DATA_DIR inside appendMemory(), which runs long after
# acquireLock() — so a fresh install (or one migrating state from a different
# plugin) crashes with ENOENT on `data/telegram.lock`. Slurp-mode perl so the
# newline in the match actually works.
perl -0777 -i -pe '
  s#(function acquireLock\(\): void \{\n)(?!\s+mkdirSync)#$1  mkdirSync(DATA_DIR, { recursive: true });\n#
' "$PLUGIN_DIR/server.ts"

# Regenerate plugin.json from upstream version
cat >"$PLUGIN_DIR/.claude-plugin/plugin.json" <<EOF
{
  "name": "telegram-supercharged",
  "description": "Supercharged Claude Code Telegram plugin — threading, voice messages 2 ways, stickers, GIFs, reactions, MarkdownV2 & more. Drop-in upgrade to the official Telegram plugin.",
  "version": "${upstream_version}",
  "author": {
    "name": "k1p1l0",
    "url": "https://github.com/k1p1l0"
  },
  "homepage": "https://github.com/k1p1l0/claude-telegram-supercharged",
  "repository": "https://github.com/k1p1l0/claude-telegram-supercharged",
  "license": "Apache-2.0",
  "keywords": ["telegram", "messaging", "channel", "mcp", "voice", "transcription"]
}
EOF

# Bump marketplace version
jq --arg v "$upstream_version" \
  '.plugins |= map(if .name == "telegram-supercharged" then .version = $v else . end)' \
  .claude-plugin/marketplace.json > .claude-plugin/marketplace.json.tmp
mv .claude-plugin/marketplace.json.tmp .claude-plugin/marketplace.json

echo ""
echo "Upstream SHA: $upstream_sha"
echo "Upstream version: $upstream_version"
echo ""
git status --short
```

## After the sync

1. Spot-check `git diff` — especially `server.ts` and `supervisor.ts` for any new hardcoded references to `channels/telegram/` or `plugin:telegram@claude-plugins-official` that weren't caught by the rename patterns.
2. Verify that the skills still work by scanning the updated `skills/*/SKILL.md` files for any `/telegram:` references the regex missed.
3. If upstream added new files, glance at them — this is a trust boundary.
4. Commit on a branch:
   ```bash
   git checkout -b chore/sync-telegram-supercharged-<short-sha>
   git add plugins/telegram-supercharged .claude-plugin/marketplace.json
   git commit -m "chore(telegram-supercharged): sync ${upstream_sha:0:12}"
   ```
5. Open a PR or push to main (user preference).

## Adding a new rebrand rule

If upstream introduces a new hardcoded reference to `telegram` that the existing patterns don't catch (e.g., a new env var like `TELEGRAM_STATE_DIR_DEFAULT`), add a new substitution to the perl one-liner in this skill. Do **not** commit manual edits — they'll be clobbered on next sync.

## When NOT to sync

- Upstream is actively in the middle of a breaking refactor (check their latest commit messages first via `gh api repos/k1p1l0/claude-telegram-supercharged/commits/master --jq '.commit.message'`).
- There are uncommitted changes in `plugins/telegram-supercharged/` — the rsync `--delete` will nuke them.
