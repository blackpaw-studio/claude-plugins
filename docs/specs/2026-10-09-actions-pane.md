# actions-pane — spec

A mod that docks a live GitHub Actions pane beside the transcript while workflow runs are active, drawn like GitHub's run view: run → jobs → steps, status icons, live durations.

## Goals

- Pane appears on its own when a run in scope starts; shows the final result for a linger window after everything finishes, then closes itself.
- Looks like watching a run on github.com: workflow card, jobs with status + duration, steps expanded for the running and failed jobs.
- Scope setting: `commit` | `branch` (default) | `repo`.
- Zero setup beyond an authenticated `gh`.

## Non-goals

- Live step logs (GitHub exposes job logs only after the job completes; no public streaming API).
- Rerun / cancel / dispatch actions. Read-only.
- GitHub Enterprise-specific handling beyond what `gh` already resolves.
- Webhook push (needs a public endpoint). Polling only.

## Approach

`gh` CLI via `$.process`, same as rich-statusline's PR collector: reuses the user's auth, resolves the repo from the git remote, returns JSON. Rejected: direct REST with a token (second auth path), `gh run watch` (one run, text output).

## Settings (`userConfig`)

| Key | Default | Meaning |
| --- | --- | --- |
| `scope` | `branch` | `commit`: runs whose `headSha` = `HEAD`. `branch`: `headBranch` = current branch. `repo`: every active run in the repo. |
| `lingerSeconds` | `30` | How long finished runs stay shown before auto-close. `0` closes immediately. |
| `activePollSeconds` | `10` | Poll interval while any in-scope run is active (floor 5). |
| `idlePollSeconds` | `60` | Poll interval while nothing is active (floor 15). |
| `autoOpen` | `true` | `false` = never opens on its own; status line hint only. |

Why `branch` default: it's what you're working on, catches push + PR runs for it, and doesn't drown you in teammates' runs. `commit` misses runs still going on the previous push.

`/actions` toggles the pane. `/actions commit|branch|repo` switches scope for this session (stored in `$.state`, not persisted).

## Data flow

1. **Context** (each poll): `git rev-parse --abbrev-ref HEAD` and `git rev-parse HEAD` in the session cwd. Detached HEAD under `branch` scope falls back to `commit`.
2. **List**: `gh run list --limit 20 --json databaseId,number,workflowName,displayTitle,event,status,conclusion,headBranch,headSha,createdAt,startedAt,updatedAt,url` (+ `--branch <b>` or `--commit <sha>` per scope).
3. **Filter**: active = status in `queued | in_progress | waiting | requested | pending`. Shown = active runs ∪ runs that completed within the linger window *and* were active while watched (no resurfacing old runs on startup).
4. **Detail**: for each shown run, `gh run view <id> --json jobs` (jobs with steps, statuses, timestamps). Completed runs are fetched once more at completion, then cached.
5. **Snapshot**: a pure function `(context, runs, jobsById, now, settings) → Snapshot` builds what the pane draws. All logic is here and tested.

Rate budget: at 10s with 3 active runs ≈ 1,440 calls/hr, under gh's 5,000/hr. On a 403/429 rate-limit response, back off to `idlePollSeconds` and show `rate limited` in the header.

**Push kick**: a `tool.call` hook watches Bash calls matching `git push`, `gh workflow run`, `gh pr create`, `gh run rerun`; after each it polls at the active rate for 2 minutes so the pane opens within seconds of a push instead of up to 60s later.

A 1s clock tick runs only while the pane is open, redrawing elapsed times and the spinner.

## Rendering

Header: `GitHub Actions · <branch|sha7|owner/repo>` dim, then one card per run, newest first:

```
◐ CI #482 · push                     1m 12s
  fix: parser edge case · a1b2c3d
  ✓ lint                                18s
  ◐ test (node 20)                   1m 04s
    ✓ Set up job                         2s
    ✓ Checkout                           1s
    ⠋ Run tests                         42s
    ○ Post checkout
  ○ build
✗ Deploy #77 · push                  3m 02s
  ✗ deploy                           2m 50s
    ✗ Upload artifacts                  31s
```

- Icons/colors: `✓` green success · `✗` red failure/timed_out · spinner (⠋⠙⠹…) yellow in_progress (run/job rows use `◐`) · `○` dim queued/waiting/pending · `⊘` dim cancelled/skipped · `!` yellow action_required.
- Steps are shown only for in_progress jobs and failed jobs (failed jobs show only the failed step). Successful jobs stay one line.
- More than 8 jobs in a run: successful ones collapse to `✓ 12 jobs passed`.
- Durations right-aligned; `<1s` → `0s`, `≥1h` → `1h 04m`. Names truncate with `…` to fit `e.viewport` width.
- Run title is a `Link` to the run URL.
- Overflow (more runs than rows): oldest finished cards drop first, then a `+N more` line.

## Lifecycle

- **Open**: first poll that sees ≥1 active in-scope run and `autoOpen` → `$.ui.open({ id: 'actions', title: 'Actions' })`.
- **Close**: all shown runs complete → linger `lingerSeconds` → close. A new run starting during linger cancels the close.
- **Manual**: pane opened with `/actions` never auto-closes; `/actions` again closes it.
- **Not placed** (pane can't seat — narrow terminal): status line entry `Actions ◐ 2 running` / `Actions ✗ 1 failed` instead; cleared on close.
- **Layout note**: the fullscreen layout docks the pane on the right from 110 cols; the main-screen layout (tmux default) places it above the prompt. Same drawing; nothing to configure.

## Errors

- Not a git repo, no GitHub remote, `gh` missing or not authenticated: mod does nothing (no pane, no polling after the first failed context check; retried on `cwd` change and `/actions`). `/actions` answers with the specific reason.
- Transient `gh` failure: keep the last snapshot, header shows `stale · 40s` once data is older than 2 poll intervals.
- All `gh` calls have a 10s timeout and `GH_PROMPT_DISABLED=1`.

## Structure

`plugins/actions-pane/` following rich-statusline: `hooks/register.tsx` (wiring only), `src/collect/` (git + gh runners, injected `run`), `src/snapshot.ts` (pure), `src/lifecycle.ts` (pure open/close state machine), `src/pane.tsx` (drawing), `src/format.ts` (durations, truncation, icons). Marketplace entry added.

## Testing

- Unit (`claude plugin test`): snapshot filtering per scope, detached-HEAD fallback, linger/close state machine (fake clock), step-expansion rules, job collapse, duration formatting, truncation, rate-limit backoff, push-kick matching.
- `gh` fixtures captured from real `gh run list`/`gh run view` JSON (no network in tests).
- Done = watching a real run on this repo in the pane, captured at native width, in both fullscreen and main-screen layouts.
