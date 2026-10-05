# rich-statusline — spec

Claude Code mod (function-hook plugin) that replaces the area under the prompt with one of three
multi-row status layouts from the Claude Design artifact
<https://claude.ai/artifact/6w9bGQT52i9wbbBiNt7dFT> (1a grouped rows, 1b labeled grid, 1c compact).

## Goals
- Match the three designs exactly (glyphs, spacing, colours, wording) on a dark terminal at ≥100 cols.
- All three layouts ship; default `1a`. Chosen in the settings panel, persisted in `$.store`.
- Add session cost (not in designs).
- Settings panel (keyboard-navigable Pane dialog).
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

## Settings panel
- Opened by `/rich-statusline` (or `/rich-statusline settings`) and a registered keybinding action
  (default chord documented in README; user-rebindable). Pane with `focus`, `closeOnEscape`; Tab/arrows walk
  controls, Enter/Space activates, Esc closes.
- Controls: layout (1a/1b/1c `Select`), show cost, show PR, show legend (1a/1b), amber threshold, red
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
| diff stats | `git diff HEAD --shortstat` (uncommitted insertions/deletions, same as ccstatusline's git-changes) → `(+12,-3)`; omitted when not a repo | with branch timer |
| PR | `gh pr view --json number,state` → `#123`; `no PR` when none or gh missing/unauthed | 60 s timer, cached, only when branch changes or timer fires |
| context tokens / window / % | `session.measure` `context` | event-driven |
| categories | `$.session.usage({ breakdown: 'summary' })`, folded into 5 (see below) | on `context` change, debounced 2 s |
| compact threshold | breakdown `autoCompactThreshold / rawMaxTokens`; marker hidden when auto-compact off | with categories |
| 5h / week limits, resets | `session.measure` `rateLimits` (`five_hour`, `seven_day`) | event-driven; reset countdowns tick every 60 s |
| cost | `session.measure` `cost` | event-driven |

Category folding: `System prompt` → system; `System tools`, `Skills`, `Custom agents`, `Slash commands` → tools;
`MCP tools` → mcp; `Memory files` → memory; `Messages` → chat. Free space and autocompact buffer are not
segments (buffer becomes the `┊` marker). Unknown future categories → tools.

## Rendering (exact)
Colours (hex from the design's oklch): text `#e3e5e8`, muted `#7d8086`, dim `#606369`, faint `#52555b`,
separator `#3f4348`, empty cell `#303338` (1c: `#2b2e33`), rule `#24272a`, system `#82baff`, tools `#3bcfcf`,
mcp + model `#c3a5f9`, memory `#ee97c9`, chat/ok `#8dca80`, amber `#f3ae58`.

**1a** — rows: `◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ <branch>  <PR>` /
`ctx  <60-cell bar █ filled, · empty, ┊ at compact threshold>  14.0% 28k/200k` /
legend indented 5 cols `■ system 6.4k  ■ tools 8.2k …  ┊ compact 85%` /
`5h  <10-cell bar, ▌ half-cell>  10%  ↻ 1h 11m  │  week <bar> 75%  ↻ 1d 12h 11m`. Gaps between spans: 2 spaces (design gap 14px ≈ 2 cells).

**1b** — 8-col label column (`model`, `where`, `context`, `limits`): rows per design with `░` empty cells
(51-cell bar), legend row with short names (`sys tools mcp mem chat · 172k free`), `limits` row, then a `─`
rule separating our grid from the engine's line below.

**1c** — full-width `▀` bar (width = `bodyColumns`), then two justified rows:
`Opus 5.5·med  ~/.l/workspace  no git · no PR` | `ctx 14%  sys tools mcp mem chat` and a second row
with the limits right-aligned `5h 10% ↻1h11m   wk 75% ↻1d12h` (left side empty — the mode moved to the engine's line).

Bar math: cells = round(tokens / window × width) per category, largest-remainder so segments sum to the
total-filled cell count; compact marker at round(threshold × width). Window = `rawMaxTokens` (scales for 1M).

Diff stats placement (not in designs): right after the branch — 1a `⎇ main (+12,-3)`, 1b `where` row `· main (+12,-3)`, 1c `main (+12,-3)`; `+N` in `#8dca80`, `-N` in `#f97770`, parens muted. Toggle in settings (default on).

Cost placement: 1a end of identity row `$1.23` muted; 1b appended to `limits` row `  ·  $1.23`; 1c before `5h`.

## Extrapolated states (veto any)
- Amber at ≥70 %, red `#f97770` at ≥90 % — applies to context % and each limit (number + bar).
- No rate limits (API key / gateway): limits row (1a/1b) hidden; 1c right side shows `ctx` only.
- No context reading yet: `ctx —` with an all-empty bar.
- Narrow terminals (by `bodyColumns`): <100 drop 1a/1b legend; <80 drop reset times and PR; <60 force 1c.
- Effort unknown (model without effort): `thinking …` omitted.
- Light theme: not designed; v1 uses the same palette (documented limitation).

## Structure
`plugins/rich-statusline/` in this repo (developed in the session dev-mods folder for hot reload, copied in when green):
- `hooks/register.tsx` — wiring only.
- `src/collect/*` — git, pr, usage collectors (each injectable for tests).
- `src/settings.ts`, `src/settings-pane.tsx` — settings model and panel.
- `src/snapshot.ts` — pure `buildSnapshot(inputs) → Snapshot`.
- `src/bar.ts`, `src/format.ts` — bar allocation, `28k`, `1d 12h 11m`, path abbreviation.
- `src/layouts/{1a,1b,1c}.tsx` — pure `Snapshot × width → tree`.
- `types/index.d.ts` — `$.state` contract.

## Testing
- Unit (TDD): bar allocation sums, compact marker position, formatters, path abbrev, category folding, thresholds, settings parsing.
- Render tests per layout against the design's fixture (Opus 5.5, medium, 28k/200k split 6.4/8.2/3.0/1.6/8.8, 5h 10 % ↻1h11m, week 75 % ↻1d12h11m) asserting exact row strings and colours, and that the engine's line is the last child unchanged.
- Settings pane UI test (mount, arrow/Tab navigation, select layout → layout re-renders), looped over terminal.
- `claude plugin validate`, `tsc`, `claude plugin test`.
- Done = live in this session, screenshot of each layout compared against the artifact.
