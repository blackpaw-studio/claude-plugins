# github-actions-pane: run ETA

## Goal
Show an estimated time remaining on in-progress runs, derived from the
durations of the same workflow's past successful runs.

## Display
- Active run card, right side: `3m 12s · ~2m left` (elapsed, then estimate).
- Remaining ≥ 60 s: whole minutes, rounded up (`~2m left`); ≥ 60 min uses
  `formatDuration` style (`~1h 04m left`).
- Remaining < 60 s and > 0: `<1m left`.
- Elapsed ≥ estimate: `over est.`
- No ETA for queued runs, finished runs, or workflows with < 3 samples.
- When the card line is too narrow for title + elapsed + ETA, drop the ETA
  first (elapsed keeps its current behaviour).

## Estimate
- Samples: the last 10 runs of the workflow with conclusion `success`, any
  branch/event. Duration per run = `updatedAt − startedAt` (fall back to
  `createdAt` when `startedAt` is missing, matching `snapshot.ts`).
  Failed/cancelled runs are excluded (they end early and skew low).
- Estimate = median of samples (mean of the middle two for even counts).
- `remainingMs = median − elapsed`, where elapsed is the card's existing
  `durationMs`.

## Fetching
- `gh run list --repo <repo> --workflow <workflow id> --status success
  --limit 10 --json startedAt,createdAt,updatedAt,conclusion`, through the
  existing `Run` port.
- Once per distinct workflow among active runs, cached in memory for the
  session. Refetched when a run of that workflow completes (its duration is
  now a sample).
- Skipped while rate-limited. A failed fetch leaves no ETA and is retried on
  a later poll — no error surfaced in the pane.
- Exact `--workflow` argument (database id vs name) is verified against real
  `gh` output during implementation; the fixture captures it.

## Code shape
- `src/eta.ts`: pure `estimateEta(samples, elapsedMs)` → `remainingMs | null`
  and the label formatter.
- `ActionsData` gains a per-workflow history map, pruned to workflows in view
  (like `watched`), updated by a pure fold alongside `withRuns`/`withJobs`.
- `Card` gains optional `remainingMs`; `layout.ts` renders and width-drops it.
- No disk state.

## Testing (test-first)
- `estimateEta`: < 3 samples → null; odd/even median; over estimate; label
  rounding at 59 s / 60 s / 61 s / 60 m boundaries.
- Snapshot: active card gets `remainingMs` from history; queued/finished do not.
- Runtime with fake `Run`: one history call per workflow, no refetch on idle
  polls, refetch after completion, none while rate-limited, failure tolerated.
- Layout: ETA dropped at narrow width, elapsed retained.

## Release
Version 0.2.0; README notes the ETA and its basis.
