# Shared GitHub poll across sessions (github-actions-pane)

## Problem
Every Claude Code session, Leo dispatches included, runs its own poller. With around 31 sessions over
about 6 repos, sessions in the same repo make identical `gh` calls. On 2026-11-15 we measured about
1,900 REST calls an hour at a steady state, and bursts went past 5,000 when CI was running in several repos.

## Goal
At most one fetch per repo, query and interval on the whole machine, however many sessions are open.
Cost should scale with the number of repos, not the number of sessions.

## Design
- **A cross-process cache at the gh port.** Wrap the plugin's gh runner (`collect/gh.ts` calls) in a
  `SharedGh` layer. The cache key is a hash of the host and the exact argv. Each call states the age
  it will accept (`maxAgeMs`); runtime passes its current cadence (active 10s, idle 60s, hidden 600s;
  job and history reads use the same value). A cached response younger than `maxAgeMs` is returned
  without a network call.
- **Single fetcher per key.** On a stale entry, try to take a per-key lock (atomic O_EXCL lockfile
  holding the pid and a time; a lock counts as stale after 30s or when its pid is dead). The winner
  fetches and writes the entry atomically (tmp file plus rename). A loser returns the stale entry if
  one exists, and otherwise waits briefly (bounded, about 2s, with an injected clock) for the
  winner's write before fetching itself.
- **Kicks** (push, `gh workflow run`) pass the time they were fired (`kickAt`) and accept only an entry
  written at or after it, so no entry from before the push is used. The first fetch after the push
  satisfies the kicks fired by the other sessions for it.
- **Shared rate-limit state.** The quota is per user, so the backoff from 0.3.2 (window, attempts,
  reason) moves into one machine-wide file that every session reads before any gh call and writes when
  it hits a limit. A session never polls during a window that another session found.
- **Failures are not cached.** Only successful responses are stored; rate-limit state is the
  exception, as above.
- **Storage:** `$XDG_CACHE_HOME/github-actions-pane/` (default `~/.cache/...`), directory mode 0700, files
  0600. Entries are validated on read; a corrupt or unparsable entry counts as a miss. Entries older
  than 1 day are pruned opportunistically.
- **Dependency injection:** fs, clock, pid-liveness and the gh runner are all ports, so tests run
  several runtimes against one fake fs.

## Out of scope
Changing cadence values, the UI, or GraphQL/`gh pr view` (not this plugin's).

## Acceptance
- Two or more runtimes with the same repo and filter, polling at the same time, make one gh call per
  interval. A test covers this with a shared fake fs and clock.
- A runtime with a shorter cadence drives the fetches, and the others reuse its result.
- A rate limit hit by one runtime suspends every runtime until the window ends.
- A crashed lock holder (dead pid or a lock older than 30s) doesn't block fetching.
- A corrupt cache file falls back to a live fetch.
- The suite stays fast (no real sleeps or network). Version 0.4.0, and the README explains the shared cache.
