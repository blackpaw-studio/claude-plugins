# Actions band above the prompt; pane on demand

Plugin: `plugins/github-actions-pane` (0.2.0 → 0.3.0)

## Goal
Make the actions pane opt-in. Surface running workflows in a one-line band
above the prompt's permission/auto-mode line instead.

## Band
- Rendered via `ui.render` on `{ component: 'AbovePrompt' }`, always calling
  `next(e)` so it chains with other bands (e.g. rich-statusline's settings band).
- Draws from the same snapshot the pane uses; polling already runs without the pane.
- States (one line, dim, truncates to width):
  - **Running** (≥1 run `in_progress`/queued): `⟳ N running · ~3m left`.
    Time = the largest `remainingMs` among running runs, formatted with the
    existing `etaLabel` (`<1m left`, `over est.` past the estimate).
    If no running run has an ETA, show the longest elapsed instead: `⟳ 1 running · 1m 40s`.
  - **Failed**: when a run finishes with failure and nothing else is running,
    show `✗ <workflow name> failed` for `lingerSeconds`, then hide.
    Multiple failures: `✗ 2 failed`.
  - **Otherwise** (success, idle, no repo, rate-limited, error): no band.
- A new run starting during a failure linger replaces it with the running state.
- Ticks with the existing 1 s clock while the band is visible, so the time counts down
  without the pane open.

## Pane
- `autoOpen` default flips from `true` to `false`. `/actions` still toggles the pane.
- Users with `autoOpen: true` keep the old behaviour; band shows in both modes.

## Units
- Pure `bandText(snapshot, now, lingerState) → string | null` in `src/band.ts`, unit-tested.
- Hook wiring in `hooks/register.tsx`; register test covers chaining and null → no band.

## Out of scope
Band click/keybinding, per-run detail in the band, config to disable the band.
