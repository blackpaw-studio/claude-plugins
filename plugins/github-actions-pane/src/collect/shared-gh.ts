// gh behind a machine-wide cache. Sessions polling the same repo make the same
// calls; here the first to find an entry stale takes a per-key lock and
// fetches, and everyone else reuses what it wrote. The rate-limit window is
// shared too: the quota is per user.
import { type BackoffStore, isInWindow } from './backoff-store'
import type { CacheFs } from './cache-fs'
import { cacheKey, decodeEntry, decodeLock, encodeEntry, encodeLock, type Freshness, isFresh, isLockStale, type CacheEntry } from './cache-entry'
import { type Ran, type Run, type RunInit, tryRun } from './run'

export type { Freshness }

/** What a gh call came to: it ran (or could not), or a shared rate-limit window held it off. */
export type GhAnswer = Ran | { kind: 'suspended'; limit: 'primary' | 'secondary'; until: number }

/**
 * Runs `argv` (gh included) or answers from the shared cache. `accept` says
 * whether a successful run's stdout is worth storing; only accepted output of
 * an exit-0 run ever is.
 */
export type GhPort = (argv: readonly string[], init: RunInit, fresh: Freshness, accept: (stdout: string) => boolean) => Promise<GhAnswer>

/** No cache, no shared window: every call runs. */
export const directGh =
  (run: Run): GhPort =>
  (argv, init) =>
    tryRun(run, argv, init)

export type SharedGhDeps = {
  run: Run
  fs: CacheFs
  backoff: BackoffStore
  now: () => Promise<number>
  /** Resolves after `ms` on the injected clock. */
  sleep: (ms: number) => Promise<void>
  host: () => Promise<string>
  /** The cache directory; null when there is no usable place (calls then run uncached). */
  dir: () => Promise<string | null>
  log: (text: string) => void
}

/** How often a loser looks for the winner's write, and how long it waits before fetching itself. */
const LOSER_POLL_MS = 250
const LOSER_WAIT_MS = 2000
/** Cache files older than this are pruned, checked at most this often. */
const PRUNE_AGE_MS = 24 * 60 * 60 * 1000
const PRUNE_EVERY_MS = 60 * 60 * 1000

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const isOurFile = (name: string): boolean => name.endsWith('.json') || name.endsWith('.lock') || name.includes('.tmp.')
const asRan = (entry: CacheEntry): Ran => ({ kind: 'ran', result: { exitCode: 0, stdout: entry.stdout, stderr: '' } })
const isStorable = (ran: Ran, accept: (stdout: string) => boolean): ran is Extract<Ran, { kind: 'ran' }> =>
  ran.kind === 'ran' && ran.result.exitCode === 0 && accept(ran.result.stdout)

export const createSharedGh = (deps: SharedGhDeps): GhPort => {
  let lockCount = 0
  let lastPrunedAt = Number.NEGATIVE_INFINITY

  const attempt = async <T>(what: string, work: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await work()
    } catch (error) {
      deps.log(`github-actions-pane: cache ${what}: ${describe(error)}`)
      return fallback
    }
  }

  const prune = async (dir: string): Promise<void> => {
    const now = await deps.now()
    if (now - lastPrunedAt < PRUNE_EVERY_MS) return
    lastPrunedAt = now
    const files = await deps.fs.list(dir)
    const old = files.filter(file => isOurFile(file.name) && now - file.mtimeMs > PRUNE_AGE_MS)
    await Promise.all(old.map(file => deps.fs.remove(`${dir}/${file.name}`)))
  }

  const suspension = async (): Promise<Extract<GhAnswer, { kind: 'suspended' }> | null> => {
    const window = await attempt('backoff read', () => deps.backoff.read(), null)
    return isInWindow(window, await deps.now()) && window !== null ? { kind: 'suspended', limit: window.limit, until: window.until } : null
  }

  return async (argv, init, fresh, accept) => {
    const dir = await deps.dir()
    if (dir === null) return tryRun(deps.run, argv, init)
    const host = await deps.host()
    const key = cacheKey(host, argv)
    const entryPath = `${dir}/${key}.json`
    const lockPath = `${dir}/${key}.lock`

    const readEntry = (): Promise<CacheEntry | null> =>
      attempt(
        'read',
        async () => {
          const text = await deps.fs.read(entryPath)
          return text === null ? null : decodeEntry(text, host, argv)
        },
        null,
      )

    const store = async (ran: Ran): Promise<void> => {
      if (!isStorable(ran, accept)) return
      await attempt('write', async () => {
        await deps.fs.writeAtomic(entryPath, encodeEntry({ host, argv, at: await deps.now(), stdout: ran.result.stdout }))
        await prune(dir)
      }, undefined)
    }

    /** Runs gh unless a window opened since the last look; stores what is worth keeping. */
    const fetch = async (): Promise<GhAnswer> => {
      const held = await suspension()
      if (held !== null) return held
      const ran = await tryRun(deps.run, argv, init)
      await store(ran)
      return ran
    }

    const release = (token: string): Promise<void> =>
      attempt(
        'unlock',
        async () => {
          const text = await deps.fs.read(lockPath)
          if (text !== null && decodeLock(text)?.token === token) await deps.fs.remove(lockPath)
        },
        undefined,
      )

    /** Takes the lock, replacing a stale holder's once. */
    const lock = async (): Promise<{ result: 'won'; token: string } | { result: 'held' | 'error' }> => {
      for (let tries = 0; tries < 2; tries += 1) {
        const now = await deps.now()
        lockCount += 1
        const token = `${now}.${lockCount}`
        const result = await attempt('lock', async () => deps.fs.createExclusive(lockPath, encodeLock({ at: now, token })), 'error' as const)
        if (result === 'won') return { result, token }
        if (result === 'error') return { result }
        const holder = await attempt('lock read', () => deps.fs.read(lockPath), null)
        if (holder === null) continue
        if (!isLockStale(decodeLock(holder), now)) return { result }
        await attempt('lock steal', () => deps.fs.remove(lockPath), undefined)
      }
      return { result: 'held' }
    }

    /** Waits for the winner's write; null if the lock goes or the wait runs out. */
    const awaitWinner = async (since: number): Promise<CacheEntry | null> => {
      for (;;) {
        await deps.sleep(LOSER_POLL_MS)
        const entry = await readEntry()
        if (entry !== null && entry.at >= since) return entry
        if ((await deps.now()) - since >= LOSER_WAIT_MS) return null
        if ((await attempt('lock read', () => deps.fs.read(lockPath), null)) === null) return readEntry().then(late => (late !== null && late.at >= since ? late : null))
      }
    }

    const cached = await readEntry()
    if (cached !== null && isFresh(cached, await deps.now(), fresh)) return asRan(cached)
    const held = await suspension()
    if (held !== null) return held

    const taken = await lock()
    if (taken.result === 'error') return fetch()
    if (taken.result === 'won') {
      try {
        const again = await readEntry()
        if (again !== null && isFresh(again, await deps.now(), fresh)) return asRan(again)
        return await fetch()
      } finally {
        await release(taken.token)
      }
    }
    // Another session is fetching this: its answer, however old, beats a second request.
    if (cached !== null) return asRan(cached)
    const since = await deps.now()
    const arrived = await awaitWinner(since)
    return arrived !== null ? asRan(arrived) : fetch()
  }
}
