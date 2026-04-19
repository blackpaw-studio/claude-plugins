#!/usr/bin/env bash
# Mirror k1p1l0/claude-telegram-supercharged master into
# plugins/telegram-supercharged/. Meant to be run by CI daily; safe to run
# locally for a manual sync.
set -euo pipefail

UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/k1p1l0/claude-telegram-supercharged.git}"
UPSTREAM_REF="${UPSTREAM_REF:-master}"
PLUGIN_DIR="plugins/telegram-supercharged"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

git clone --depth 1 --branch "$UPSTREAM_REF" "$UPSTREAM_REPO" "$work_dir/src" >/dev/null 2>&1
upstream_sha="$(git -C "$work_dir/src" rev-parse HEAD)"
upstream_version="$(jq -r '.version' "$work_dir/src/package.json")"

rsync -a --delete \
  --exclude='.git' \
  --exclude='.github' \
  --exclude='.claude-plugin/' \
  --exclude='NOTICE' \
  "$work_dir/src/" "$PLUGIN_DIR/"

mkdir -p "$PLUGIN_DIR/.claude-plugin"
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
  "keywords": [
    "telegram",
    "messaging",
    "channel",
    "mcp",
    "voice",
    "transcription"
  ]
}
EOF

jq --arg v "$upstream_version" \
  '.plugins |= map(if .name == "telegram-supercharged" then .version = $v else . end)' \
  .claude-plugin/marketplace.json >.claude-plugin/marketplace.json.tmp
mv .claude-plugin/marketplace.json.tmp .claude-plugin/marketplace.json

echo "upstream_sha=$upstream_sha"
echo "upstream_version=$upstream_version"
