# rich-statusline

A Claude Code mod (function-hook plugin) that draws a multi-row status
dashboard under the prompt: model and effort, where you are (path, git
branch, uncommitted diff stats, PR), the context window broken down by
category, the 5-hour and weekly usage limits with reset countdowns, and the
session's cost.

Three layouts, switchable live:

- **Grouped rows** (1a): identity, a 60-cell context bar with the
  auto-compact marker, a category legend, and the limits.
- **Labeled grid** (1b, default): `model` / `where` / `context` / `limits`
  columns.
- **Compact** (1c): a full-width bar and two justified rows.

Claude Code's own permission-mode line and its hint text (`? for shortcuts`,
`esc to interrupt`, task pills) stay exactly as the engine draws them.

## Install

From this marketplace:

```shell
/plugin marketplace add blackpaw-studio/claude-plugins
/plugin install rich-statusline@blackpaw-plugins
```

Then **remove any `statusLine` entry from your `settings.json`**. A mod cannot
hide the settings status line, so leaving it in place draws both.

## Settings

Run `/rich-statusline` (or `/rich-statusline settings`) to open the settings
menu in the band above the prompt; run it again to close it. Press
**ctrl+x tab** to focus the menu, then Tab or the arrow keys move between
controls and Enter changes one. **Done** (`d`) closes the menu, **Reset to
defaults** (`r`) restores the defaults. Changes apply immediately and are
saved in the plugin's store.

The menu lives in the band rather than a side pane because panes do not draw
in some terminal setups (Claude Code inside tmux, for one).

| Setting | Default | |
|---|---|---|
| Layout | Labeled grid | Grouped rows, Labeled grid or Compact |
| Show cost | on | 1a: end of the first row; 1b: limits row; 1c: before `5h` |
| Show PR | on | `#123` from `gh pr view`; `no PR` when there is none or `gh` is missing |
| Show diff stats | on | `(+12,-3)` from `git diff HEAD --shortstat`, after the branch |
| Show legend | on | the category legend of 1a and 1b |
| Amber at | 70% | context and each limit turn amber from here |
| Red at | 90% | ...and red from here |
| Git refresh | 10 s | branch and diff stats |
| PR refresh | 60 s | also refreshed at once when the branch changes |

There is no keyboard shortcut: this build of the plugin API lets a Button
bind only the engine's own keybinding actions, not a plugin-defined one.

## Behaviour

- **Terminal only.** On desktop, VS Code and mobile the hint line is left as
  the engine draws it.
- **Narrow terminals:** under 100 columns the legend goes; under 80 the reset
  countdowns and the PR go and the context bar shrinks to fit; under 60 the
  compact layout is used whatever is chosen.
- **No rate limits** (API key, gateway): the limits row is hidden.
- **Before the first response:** `ctx —` over an empty bar.
- The category split uses the local `summary` estimate of `/context` (no
  token-count requests), refreshed two seconds after the context last changed.
- `git` and `gh` run through the host with a timeout; a render never waits on
  them. Outside a repository the row reads `no git` and `gh` is not asked.

## Limitations

- **Light themes are not designed for.** The palette is the dark design's.
- Column widths count characters, not display cells: a path or branch with
  wide characters (CJK, emoji) can push a 1c row past the edge, where it is
  cut off.
- Category sizes are estimates, so they need not add up to the exact
  `28k/200k` figure, which is the last API response's.

## Development

```sh
claude plugin validate plugins/rich-statusline
claude plugin test plugins/rich-statusline
```

Type-checking needs the declarations the engine lays into
`.claude-plugin/types/` when it loads the mod from a folder you own (a
`--plugin-dir` or the session's mods folder); `tsc -p` that folder.
