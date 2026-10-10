#!/bin/zsh
# Records a real Claude Code session with actions-pane loaded from this
# checkout, watching the fake gh's scripted run timeline (bin/gh) in a
# throwaway git repo. Nothing reaches GitHub.
#
# Usage: record.sh <name> [fullscreen|main] [cols] [rows] [seconds]
# Writes out/<name>/: session.cast, markers.txt, frames/<t>.ansi (tmux
# capture-pane -e every second, for checking colours at native cells) and
# gh.log (every gh call the mod made, with the timeline second).
set -u
setopt null_glob
HERE=${0:A:h}
PLUGIN=${HERE:h:h}
NAME=${1:?name}
LAYOUT=${2:-fullscreen}
COLS=${3:-150}
ROWS=${4:-40}
SECONDS_TOTAL=${5:-110}
OUT=$HERE/out/$NAME
SOCK=actions-demo-$NAME
PANE=rec
mkdir -p $OUT/frames
rm -f $OUT/frames/* $OUT/markers.txt $OUT/gh.log $OUT/start

t() { tmux -L $SOCK "$@"; }
now() { perl -MTime::HiRes=time -e 'printf "%.3f\n", time'; }
screen() { t capture-pane -p -t $PANE; }
mark() { echo "$1 $(now)" >> $OUT/markers.txt; }
wait_for() { # pattern timeout_s
  local i=0
  while (( i < $2 * 2 )); do screen | grep -q -- "$1" && return 0; sleep 0.5; i=$((i + 1)); done
  echo "timeout waiting for: $1" >&2; screen >&2; return 1
}

# The repo the session runs in: on main, one commit, a GitHub-looking remote.
REPO=$OUT/repo
rm -rf $REPO && mkdir -p $REPO
git -C $REPO init -q -b main
git -C $REPO -c user.name=demo -c user.email=demo@example.com commit -q --allow-empty -m "fix: parser edge case"
git -C $REPO remote add origin https://github.com/acme/widgets.git

# The demo polls at the floors (5s active, 15s idle) so the pane opens soon
# after the scripted run starts; lingerSeconds and the rest are the defaults.
cat > $OUT/settings.json <<EOF
{ "pluginConfigs": { "actions-pane": { "options": { "activePollSeconds": ${ACTIVE_POLL:-5}, "idlePollSeconds": ${IDLE_POLL:-15} } } } }
EOF

NO_FLICKER=0
[[ $LAYOUT == fullscreen ]] && NO_FLICKER=1
cat > $OUT/run-claude.sh <<EOF
#!/bin/zsh
cd "$REPO"
export PATH="$HERE/bin:/Users/evan/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export ACTIONS_DEMO_START_FILE="$OUT/start" ACTIONS_DEMO_LOG="$OUT/gh.log" CLAUDE_CODE_NO_FLICKER=$NO_FLICKER
# User settings left out: no other plugins, hooks or status line in the frame.
exec claude --plugin-dir "$PLUGIN" --setting-sources project,local --settings "$OUT/settings.json" --model haiku --permission-mode default
EOF
chmod +x $OUT/run-claude.sh

t kill-server 2>/dev/null
t -f /dev/null new-session -d -s $PANE -x $COLS -y $ROWS
t set -g status off
t resize-window -t $PANE -x $COLS -y $ROWS
t send-keys -t $PANE "clear; exec env -i HOME=\$HOME USER=\$USER LOGNAME=\$LOGNAME SHELL=/bin/zsh PATH=/opt/homebrew/bin:/usr/bin:/bin LANG=en_US.UTF-8 TERM=xterm-256color COLORTERM=truecolor asciinema rec -q -I -f asciicast-v2 --overwrite -c $OUT/run-claude.sh $OUT/session.cast" Enter

wait_for "for shortcuts\|trust this folder" 60 || exit 1
if screen | grep -q "trust this folder"; then t send-keys -t $PANE Down; sleep 0.5; t send-keys -t $PANE Enter; fi
wait_for "for shortcuts" 60 || exit 1
sleep 2
mark ready
now > $OUT/start
mark start
for i in {1..$SECONDS_TOTAL}; do
  sleep 1
  t capture-pane -e -p -t $PANE > $OUT/frames/$(printf %03d $i).ansi
done
mark end
t send-keys -t $PANE C-d; sleep 0.6; t send-keys -t $PANE C-d; sleep 2
t kill-server 2>/dev/null
echo "recorded: $OUT"
