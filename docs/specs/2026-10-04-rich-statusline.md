# rich-statusline — spec

Claude Code mod (function-hook plugin) that replaces the area under the prompt with one of three
multi-row status layouts from the Claude Design artifact
<https://claude.ai/artifact/6w9bGQT52i9wbbBiNt7dFT> (1a grouped rows, 1b labeled grid, 1c compact).

## Goals
- Match the three designs exactly (glyphs, spacing, colours, wording) on a dark terminal at ≥100 cols.
- All three layouts ship; default `1b` (Evan, 2026-10-05). The layout picker shows plain names (Grouped rows,
  Labeled grid, Compact); stored values stay `1a`/`1b`/`1c`. Chosen in the settings menu, persisted in `$.store`.
- Add session cost (not in designs).
- Settings menu (keyboard-navigable, in the band above the prompt).
- The permission-mode line is Claude Code's own and is left untouched; the designs' mode row
  (`▸▸ auto mode …`, `6 agents running`, 1c's `▸▸ auto ⇧⇥  6 agents`) is not drawn by this mod. Running
  background agents remain visible through the engine's own task pill on that line.

## Non-goals
- Desktop / VS Code / mobile surfaces (terminal only for v1; elsewhere the hook passes through).
- Exact `/context` token counting (uses local `summary` estimates).
- Hiding the user's `statusLine` settings command — a mod can't; the README says to remove it.

## Surface
- `ui.render` on `PromptHint`: `const engine = await next(e)`, return a column of our layout rows followed by
  `engine` unchanged — permission mode, task pills, `esc to interrupt`, `? for shortcuts` stay the engine's.
- `SessionMode` passes through unchanged.
- **Prototype gate — passed 2026-10-04:** `PromptHint` draws a multi-row tree. The permission-mode/agents line
  is a separate engine row *above* `PromptHint` (below any settings `statusLine`), so the actual order is
  prompt → engine mode line → our rows → engine hint text (when non-empty). We never touch the mode line.

## Settings menu
- Drawn in the band above the prompt (`ui.render` on `AbovePrompt`), not a Pane: in Evan's terminal (Claude
  Code inside tmux under Leo) a placed Pane's render hook is never invoked (reproduced with a bare probe mod),
  while the band draws, focuses and takes keys. Changed 2026-10-05, Evan-approved.
- `/rich-statusline` (or `/rich-statusline settings`) toggles a `settingsOpen` state value; no output row, no
  pane. A keybinding action is not supported by the plugin API (Button `action` accepts engine actions only).
- While open (and no survey holds the band): a title row with the bold `rich-statusline settings` and the
  `Done` (hotkey `d`, closes the menu) and `Reset to defaults` (`r`) buttons, so they are always visible; a dim
  hint row `ctrl+x tab to focus · ↑↓/tab move · enter change`; then the controls two to a row once
  `bodyColumns` fits two cells of (longest label + longest option + 4 Select chrome), else one, so no cell
  wraps. Over `maxRows` the hint row goes first, then three to a row when the width allows; still taller, the
  engine scrolls it.
- Controls: layout (1a/1b/1c `Select`), show cost, show PR, show diff stats, show worktree, show legend (1a/1b), amber threshold, red
  threshold, git refresh seconds, PR refresh seconds. Changes apply live and persist in `$.store`.
- Settings are a validated `Settings` value (pure `parseSettings(raw) → Settings` with defaults; invalid
  stored values fall back to defaults).

## Data model (one `Snapshot`, built by a pure function from collected inputs)
| Field | Source | Refresh |
|---|---|---|
| model display name | `$.session.model()` → map id → `Opus 5.5` | session.start, turn.step |
| effort | `turn.step` `e.effort`; before first step, `settings.read` `effortLevel`; else omitted | turn.step |
| cwd (abbreviated `~/.l/workspace` style: home→`~`, intermediate segments to first char, last kept) | `$.session.cwd()` | session.start, tool.call Bash cd |
| branch | `git rev-parse --abbrev-ref HEAD` via `$.process.run`; `no git` when not a repo | 10 s timer, cached |
| worktree | `git rev-parse --path-format=absolute --git-dir --git-common-dir`; differing dirs = linked worktree, named after the basename of `--show-toplevel`; nothing on the main working tree or outside a repo; same env and keep-cache-on-failure rules as branch | with branch timer |
| diff stats | `git diff HEAD --shortstat` (uncommitted insertions/deletions, same as ccstatusline's git-changes) → `(+12,-3)`; omitted when not a repo | with branch timer |
| PR | `gh pr view --json number,state` → `#123`; `no PR` when none or gh missing/unauthed | 60 s timer, cached, only when branch changes or timer fires |
| context tokens / window / % | `session.measure` `context` | event-driven |
| categories | `$.session.usage({ breakdown: 'summary' })`, folded into 5 (see below) | on `context` change, debounced 2 s |
| compact threshold | breakdown `autoCompactThreshold / context.window`; marker hidden when auto-compact off | with categories |
| 5h / week limits, resets | `session.measure` `rateLimits` (`five_hour`, `seven_day`) | event-driven; reset countdowns tick every 60 s |
| cost | `session.measure` `cost` | event-driven |

Category folding: `System prompt` → system; `System tools`, `Skills`, `Custom agents`, `Slash commands` → tools;
`MCP tools` → mcp; `Memory files` → memory; `Messages` → chat. Free space and autocompact buffer are not
segments (buffer becomes the `┊` marker). Unknown future categories → tools.

## Rendering (exact)
Colours: the terminal theme palette, normal slots; Evan-approved 2026-10-05. No hex anywhere, so the rows follow
the person's theme (light or dark). text = default fg; muted = gray (bright black, slot 8, the one exception: no
normal slot is gray); dim, faint and separator = default fg + `dimColor`; empty cells = gray + `dimColor`;
system = blue, tools = cyan, mcp = magenta, memory = red, chat = green; model name = magenta, cwd = blue;
ok = green, amber level = yellow, red level = red. The design's three greys (muted/dim/faint) collapse to two tiers:
gray and dimColor. Slots are written `ansi256(n)` (n < 16 is the theme's own entry): the plugin API refuses
`ansi:<name>` (no `:` in a colour) and the renderer drops a bare `red` as an unknown theme key.

Deviation: in 1a and 1b, filled cells use ▆ for row spacing (limit bars in whole cells, no ▌: rounded, but any use shows at least one cell and anything under 100 % leaves at least one empty); 1c keeps ▀. Evan-approved 2026-10-05.
Padding: one blank row above the block, none below (the engine hint line, when present, follows our last row
directly); 2-space gaps; Evan-approved 2026-10-05.

**1a** — rows: `◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ <branch>  <PR>` /
`ctx  <60-cell bar █ filled, · empty, ┊ at compact threshold>  14.0% 28k/200k` /
legend indented 5 cols `■ system 6.4k  ■ tools 8.2k …  ┊ compact 85%` /
`5h  <10-cell bar, ▌ half-cell>  10%  ↻ 1h 11m  │  week <bar> 75%  ↻ 1d 12h 11m`. Gaps between spans: 2 spaces (design gap 14px ≈ 2 cells).

**1b** — 8-col label column (`model`, `where`, `context`, `limits`): rows per design with `░` empty cells
(51-cell bar), legend row with short names (`sys tools mcp mem chat · 172k free`), `limits` row. No bottom `─` rule
(it separated the grid from the old mode footer, which now sits above the block; Evan, 2026-10-05).

**1c** — full-width `▀` bar (width = `bodyColumns`), then two justified rows:
`Opus 5.5·med  ~/.l/workspace  no git · no PR` | `ctx 14%  sys tools mcp mem chat` and a second row
with the limits right-aligned `5h 10% ↻1h11m   wk 75% ↻1d12h` (left side empty — the mode moved to the engine's line).

Bar math: cells = round(tokens / window × width) per category, minimum 1 cell for any category with tokens > 0;
if the total passes the width, trim one cell at a time from the largest category. Fixture at 60 cells → 2,2,1,1,3 = 9
(matches the design). Compact marker at round(threshold × width). Window = `context.window` (the model window shown in the label; scales for 1M). The compaction window (`rawMaxTokens`) is not used, so bar, label and marker agree.

Diff stats placement (not in designs): right after the branch — 1a `⎇ main (+12,-3)`, 1b `where` row `· main (+12,-3)`, 1c `main (+12,-3)`; `+N` green, `-N` red, parens muted. Toggle in settings (default on).

Worktree (Evan, 2026-10-05): in a linked worktree, right before the branch, `wt <name>` with `wt` muted and the name in
magenta — 1a `~/.l/x  wt feat-x  ⎇ branch (+1,-0)`, 1b `where` row `~/.l/x  ·  wt feat-x  ·  branch (+1,-0)`,
1c `wt feat-x branch (+1,-0)`. Toggle "show worktree" (default on). On overflow the identity/where row drops cost
(1a), then PR, then diff stats, then the worktree (1c: within the width left of `ctx N%`); if still too wide,
its end (branch, then path) is cut with `…`. Every row in every layout stays within `bodyColumns`.

Cost placement: 1a end of identity row `$1.23` muted; 1b appended to `limits` row `  ·  $1.23`; 1c before `5h`.

## Extrapolated states (veto any)
- Amber at ≥70 %, red at ≥90 % — applies to context % and each limit (number + bar).
- No rate limits (API key / gateway): limits row (1a/1b) hidden; 1c right side shows `ctx` only.
- No context reading yet: `ctx —` with an all-empty bar.
- Narrow terminals (by `bodyColumns`): <100 drop 1a/1b legend; <80 drop reset times and PR; <60 force 1c.
- Effort unknown (model without effort): `thinking …` omitted.
- Light theme: not designed; v1 uses the same palette (documented limitation).

## Structure
`plugins/rich-statusline/` in this repo (developed in the session dev-mods folder for hot reload, copied in when green):
- `hooks/register.tsx` — wiring only.
- `src/collect/*` — git, pr, usage collectors (each injectable for tests).
- `src/settings.ts`, `src/settings-controls.ts`, `src/settings-band.tsx` — settings model and the band menu.
- `src/snapshot.ts` — pure `buildSnapshot(inputs) → Snapshot`.
- `src/bar.ts`, `src/format.ts` — bar allocation, `28k`, `1d 12h 11m`, path abbreviation.
- `src/layouts/{1a,1b,1c}.tsx` — pure `Snapshot × width → tree`.
- `types/index.d.ts` — `$.state` contract.

## Testing
- Unit (TDD): bar allocation sums, compact marker position, formatters, path abbrev, category folding, thresholds, settings parsing.
- Render tests per layout against the design's fixture (Opus 5.5, medium, 28k/200k split 6.4/8.2/3.0/1.6/8.8, 5h 10 % ↻1h11m, week 75 % ↻1d12h11m) asserting exact row strings and colours, and that the engine's line is the last child unchanged.
- Settings menu UI test (band mount, Done/Reset on the title row under a short `maxRows`, select layout → layout
  re-renders), looped over terminal.
- `claude plugin validate`, `tsc`, `claude plugin test`.
- Done = live in this session, screenshot of each layout compared against the artifact.
