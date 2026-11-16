# Implementation plan: shared cross-session poll (github-actions-pane 0.4.0)

Spec: `docs/specs/2026-11-15-shared-poll.md`. Plugin root: `plugins/github-actions-pane`. If this plan and the spec disagree, the spec wins. Every step starts with a failing test, then the smallest change that makes it pass. Commit after each step.

## Engine constraint the spec doesn't mention (read first)
Hook code can't touch the filesystem directly. The only file API is `$.fs`, which offers `read`, `write`, `list`, `stat` and `ancestors`. It has no exclusive create, no rename, no chmod, no unlink and no pid lookup. `claude plugin test` runs with no fs or process at all. The plan therefore puts all file work behind a `CacheFs` port:
- **Reads** use `$.fs.read` and `$.fs.list`. `list` gives `mtimeMs`, which pruning needs.
- **Mutations** use small `sh` scripts run through `$.process.run`. Content goes in on `stdin`, which `ProcessRunInit` supports. So `RunInit` in `src/collect/run.ts` gains `stdin?: string`.
- **Tests** use an in-memory fake.

The `sh` scripts live in `src/collect/cache-fs.ts`, take only positional args and use `umask 077`:
- `ensureDir`: `mkdir -p -m 700 "$1"`. Runs once per process (memoized).
- `writeAtomic`: `cat > "$1.tmp.$$" && mv -f "$1.tmp.$$" "$1"`, removing the tmp file on failure. `mv` is rename(2), which is atomic on APFS.
- `createExclusive`: write the full content to a tmp file, then `ln tmp "$1"`, then remove the tmp file.
  - `link(2)` fails if the target exists, so this is the O_EXCL step.
  - A lock file is never seen half-written.
  - Exit 0 means won. Non-zero with the target present means held. Non-zero with no target is an error: log it and fetch without the lock.
- `remove`: `rm -f "$1"`.
- `isAlive(pid)`: `kill -0 <pid>`, after checking that `pid` is a positive integer. Exit 0 means alive.

## Interfaces (new files under `src/collect/`)
```ts
// shared-gh.ts
export type Freshness = { maxAgeMs: number; isKick: boolean }
export type GhAnswer = Ran | { kind: 'suspended'; limit: 'primary' | 'secondary'; until: number }
export type GhPort = (argv: readonly string[], init: RunInit, fresh: Freshness,
                      accept: (stdout: string) => boolean) => Promise<GhAnswer>
export const directGh = (run: Run): GhPort            // no cache; fresh/accept ignored
export type SharedGhDeps = { run: Run; fs: CacheFs; backoff: BackoffStore; now: () => Promise<number>;
  sleep: (ms: number) => Promise<void>; isAlive: (pid: number) => Promise<boolean>;
  pid: () => Promise<number | null>; host: () => Promise<string>; dir: () => Promise<string>; log: (t: string) => void }
export const createSharedGh = (deps: SharedGhDeps): GhPort
// cache-fs.ts
export type CacheFs = { read(p): Promise<string | null>; writeAtomic(p, text): Promise<void>;
  createExclusive(p, text): Promise<'won' | 'held' | 'error'>; remove(p): Promise<void>;
  list(dir): Promise<{ name: string; mtimeMs: number }[]> }
// backoff-store.ts
export type SharedBackoff = { until: number; attempts: number; limit: 'primary' | 'secondary' }
export type BackoffStore = { read(): Promise<SharedBackoff | null>; write(b: SharedBackoff): Promise<void>;
  clearIf(until: number): Promise<void> }   // removes only if the stored until still equals `until`
export const memoryBackoff = (): BackoffStore; export const fileBackoff = (fs, dir, now): BackoffStore
```

### Files on disk
All files live in `$XDG_CACHE_HOME/github-actions-pane/`. `XDG_CACHE_HOME` counts only if it is set and absolute; otherwise the dir is `$HOME/.cache/github-actions-pane/`.

| File | Contents | Validation |
|---|---|---|
| `<key>.json` (cache entry) | `{"v":1,"host":"github.com","argv":[...],"at":<ms>,"stdout":"..."}` | A wrong `v`, host or argv, a non-finite `at`, or a non-string `stdout` counts as a miss. |
| `<key>.lock` | `{"v":1,"pid":<int\|null>,"at":<ms>,"token":"<random>"}` | Stale when `now - at > 30_000`, when the pid is non-null and dead, or when the file is unparsable. |
| `rate-limit.json` | `{"v":1,"until":<ms>,"attempts":<n>,"limit":"primary"\|"secondary","at":<ms>}` | Corrupt means no window. `until` is clamped on read to `now + MAX_SUSPEND_MS + RATE_LIMIT_JITTER_MS`. |

- **Key:** pure-TS FNV-1a 64-bit (BigInt) over `host + "\0" + argv.join("\0")`, as hex. There is no guarantee `crypto` exists in the sandbox. A hash collision only causes a miss, because the stored `argv` is checked on read.
- **Host:** `GH_HOST`, or `github.com` when unset. That is what `gh --repo owner/name` resolves to.

## Steps

**1. Cadence is exported** (`src/schedule.ts`)
- Export `cadenceMs(inputs)`. `nextPollMs` stays `max(cadenceMs, suspendedForMs)`.
- Failing test (`schedule.test.ts`): `cadenceMs` returns active, kick, waiting, open and hidden values with `suspendedForMs` ignored.

**2. Pure codecs** (`src/collect/cache-entry.ts`, new test file)
- Functions: `cacheKey`, `encodeEntry`/`decodeEntry`, `isFresh(entry, now, fresh)`, `decodeLock`/`isLockStale(lock, now, isAlive)`, `cacheDir({xdg, home})`, `decodeBackoff`.
- Freshness rules:
  - Fresh when `0 <= age < maxAgeMs - FRESH_SLACK_MS`, with `FRESH_SLACK_MS = 1000`.
  - With `isKick`, fresh only when `age < 3000`.
  - An entry dated in the future is stale.
- Failing tests:
  - Key is stable and changes with host or argv.
  - Each corrupt shape decodes to null.
  - Freshness boundaries at `maxAgeMs - 1000`, a kick at 2999 vs 3000, and a future `at`.
  - Lock is stale at 30 001 ms and with a dead pid; a lock with a null pid is held at 29 s.
  - `cacheDir` ignores a relative XDG path.

**3. Test fakes** (`src/testing/`)
- Extract `fakeClock(start)` from `fakeWorld`, holding `now`, `after`, `every`, `advance` and `waiting`. `fakeWorld(start, overrides, clock = fakeClock(start))` uses it.
- Add `fakeCacheFs()`: in-memory, with exclusive-create semantics, the ability to inject a corrupt file, and settable `mtimeMs`.
- Gate: `runtime.test.ts` stays green with no edits.

**4. SharedGh** (`src/collect/shared-gh.ts`, `shared-gh.test.ts`)
- Flow for each call:
  1. Read the entry. If it is fresh, return it with no network call.
  2. Read the shared backoff. If inside the window, return `suspended`.
  3. Try `createExclusive` on the lock. A stale lock is removed and retried once.
- Winner:
  - Re-reads the entry and returns it if it is now fresh.
  - Otherwise checks the backoff again, runs `gh`, and writes the entry only if `exitCode === 0 && accept(stdout)`.
  - Removes the lock in `finally`, after re-reading it and checking the token.
- Loser:
  - Returns a valid stale entry if one exists.
  - Otherwise polls every 250 ms through `deps.sleep`, for at most 2000 ms by `deps.now`, until an entry with `at >= waitStart` appears.
  - If the lock vanishes or the 2 s run out, it checks the backoff and fetches itself, without a lock.
  - Production `sleep` is `ms => new Promise(r => $.clock.after(ms, r))`. Tests drive it with `fakeClock.advance`, so there are no real sleeps.
- Pruning:
  - After a winner's write, at most once per process-hour, list the dir.
  - Remove `*.json`, `*.lock` and `*.tmp.*` files whose `mtimeMs` is more than one day old.
  - Keep `rate-limit.json` unless it is both expired and more than a day old.
- Failing tests, one each:
  - A miss fetches and writes.
  - A fresh hit makes no `run` call.
  - A kick bypasses freshness at 3 s but not at 2 s.
  - A loser with a stale entry makes no `run` call. This uses a deferred fake `run` so the winner is mid-fetch.
  - A loser with no entry gets the winner's write at 1.5 s.
  - A loser with no entry fetches itself at 2 s.
  - A dead-pid lock is stolen.
  - A 31 s-old lock is stolen.
  - A corrupt entry leads to a live fetch.
  - Non-zero exit, `accept=false` and a thrown `run` are not cached, and the lock is still released.
  - A backoff window returns `suspended` with no `run` call.
  - Pruning removes only files more than a day old.

**5. gh.ts on the port** (`src/collect/gh.ts`, `gh.test.ts`)
- `listRuns`, `listDurations` and `viewJobs` take `(gh: GhPort, cwd, repo, …, fresh: Freshness)`.
- The internal `gh()` passes `accept = s => parse(s) !== null` and maps `suspended` to `{kind:'rate-limited', limit, retryAfterMs: null}`.
- `repoName` and `rateLimitReset` keep taking `Run` and are not cached (open question 6).
- Update existing tests mechanically: wrap their runner as `directGh(run)`.
- Failing test: a `suspended` answer classifies as rate-limited with no gh call.

**6. Runtime on shared freshness and backoff** (`src/runtime.ts`)
- `Ports` gains `gh: GhPort` and `backoff: BackoffStore`. `fakeWorld` defaults them to `directGh(run)` and `memoryBackoff()`. That default keeps every existing test, including the 0.3.2 backoff tests at 902–1042, on per-world state, so they need no change. Running them is the guard.
- `kick()` sets a `kickPending` flag. `pollOnce` takes it (clears it) and builds `fresh = { maxAgeMs: cadenceMs({...inputs at poll start}), isKick }`. That object goes to every list, history and jobs call in the poll.
- The `backoff` variable becomes a mirror of the store:
  - `pollOnce` reads the store first and refreshes the mirror. `isInWindow` and `intervalAt` keep reading the mirror, so they stay synchronous.
  - `holdOff` re-reads the store. If it is in a window (this session's or another's), it publishes `isRateLimited`/`rateLimitedUntil` if they differ and returns. Otherwise it sets `attempts = stored.attempts + 1` and writes.
  - `settleBackoff` calls `clearIf(stored.until)` when the stored window ended before `startedAt`, and always clears the session's UI flag.
- `start()` writes the restored session window into the store only when the store is empty or its window ends earlier (open question 9).
- Failing test: `fakeWorld` with a `backoff` override that already holds a window. `start()` must not poll until the window ends.

**7. Multi-runtime acceptance** (`src/runtime.shared.test.ts`, new file; `runtime.test.ts` is already 1042 lines)
- Two or three `fakeWorld`s share one `fakeClock`, one `fakeCacheFs`, one `fileBackoff` and one counted fake `run`, each through `createSharedGh`.
- Failing tests:
  - Same repo and filter: one `gh run list` per interval across 3 runtimes over 5 intervals.
  - Pane open at 60 s vs hidden at 600 s: the 60 s runtime makes every fetch; the hidden one makes none.
  - A runs active at 10 s alongside an idle runtime at 60 s: A drives.
  - A hits a secondary limit: B makes no gh call until the window ends, then both resume.
  - Two kicks within 1 s: one fetch.
  - A corrupt entry dropped in mid-run: one live fetch, then normal operation.

**8. Host wiring** (`src/collect/cache-fs.ts`, `hooks/register.tsx`)
- `createHostCacheFs({ readText, list, run })` holds the `sh` scripts above.
- In `portsOf`:
  - `dir` comes from `$.env.get("XDG_CACHE_HOME")` / `$.env.get("HOME")`. Both names must be string literals.
  - `host` comes from `$.env.get("GH_HOST")`.
  - `pid` is `sh -c 'echo $PPID'`, memoized. If its output is not an integer, use null.
  - `gh = createSharedGh(...)` and `backoff = fileBackoff(...)` are hoisted so one instance lives per module load.
- Any test of the `sh` scripts' argv shape is glue (a TDD exception; note that in the commit). Real behavior is checked in the smoke step below.

**9. Docs and version**
- README: a "Shared cache" section covering location, modes, what is cached, kick dedupe, the shared rate limit, and that deleting the dir is safe.
- Bump `.claude-plugin/plugin.json` to 0.4.0, plus the marketplace entry if it carries a version.

## Verification
- Per step: `cd plugins/github-actions-pane && claude plugin test .`, or only the touched test file.
- Integration gate:
  - `claude plugin test .` and `claude plugin validate .`. Validate must list `XDG_CACHE_HOME`, `HOME` and `GH_HOST`.
  - `npx -y -p typescript@5 tsc -p tsconfig.json --noEmit`. Only the two errors already on main may appear, in `hooks/register.test.tsx` and `src/snapshot.test.ts`. Record the baseline first.
  - Check that the suite's runtime hasn't grown noticeably.
- Smoke check (orchestrator; this needs real sessions):
  - Run the `sh` scripts in a loop with two concurrent `createExclusive` calls: exactly one wins.
  - Start two sessions in one repo with a PATH shim that logs every `gh` argv with a timestamp. Over 5 minutes, list calls should come at about one per interval, not two.
  - `ls -la ~/.cache/github-actions-pane` should show the dir at 700 and files at 600.

## Risks / accepted
- **Stale-lock steal race:** two losers can both remove a stale lock. The worst case is two fetches once. Accepted.
- **Backoff races:** `clearIf` races a new window from another session (a read-then-write gap), and two first hits can both write `attempts: 1`. Accepted.
- **Jitter is moot:** every session reads the same `until`. That's fine, because only one fetch per key follows.
- **Extra spawns on a miss:** about three `sh` calls (lock, write, unlock) per gh call, versus a network round trip. They could be merged into one script later.
- **Cache dir trust:** an existing cache dir with a wrong owner or mode is not checked. Single-user Mac; accepted unless the reviewer objects.

## Open questions the spec leaves open (defaults chosen, please confirm)
1. **Own pid:** the spec relies on the lock holder's pid, but the engine doesn't expose it. `$PPID` from `sh` may be a helper process rather than the Claude process. If so, `pid` is null and only the 30 s rule applies, which is still safe because gh's timeout is 10 s.
2. **`$.fs.read`/`list` outside the cwd** may be refused by `fs.*` hooks or permissions. Untested. The fallback is `cat`/`ls` through `run`.
3. **`fetchedAt` on a cached answer:** this plan keeps poll time. The entry's `at` would be more honest about data age.
4. **`FRESH_SLACK_MS = 1000`** is not in the spec. Without it, a timer firing up to 50 ms early would see its own entry as fresh and double the effective interval.
5. **Hash:** the spec says "hash" without naming one. The plan uses FNV-1a, verified against `argv`, rather than relying on `crypto`.
6. **`gh repo view` and `gh api rate_limit` are not cached.** `gh repo view`'s argv carries no repo, so its key would collide across cwds. `rate_limit` must be read live.
7. **Loser and kicks:** a loser returns the stale entry even on a kick. The kick's active cadence picks up the winner's result about 10 s later.
8. **Failure in a window:** a failed call during another session's window comes back as rate-limited with `retryAfterMs: null`. Its UI reads the window from the store.
9. **Restored session window:** it seeds the shared store only when the store is empty or its window ends earlier.

## Orchestrator decisions
All defaults in "Open questions" (1-9) are accepted as written. Where the spec and this plan disagree, the spec wins.
