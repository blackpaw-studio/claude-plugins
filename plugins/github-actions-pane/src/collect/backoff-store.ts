// Where the rate-limit window lives. The quota is per user, so every session
// on the machine shares one window (a file); tests and a cache-less host use
// memory.
import type { CacheFs } from './cache-fs'
import { decodeBackoff, encodeBackoff, type SharedBackoff } from './cache-entry'

export type { SharedBackoff }

/** A quota resets hourly: a reset further off than this is skew or junk, and is not waited for. */
export const MAX_SUSPEND_MS = 60 * 60 * 1000
/** Added after a quota reset so sessions sharing one token don't all resume on the same second. */
export const RATE_LIMIT_JITTER_MS = 10 * 1000
/** The furthest a stored window is believed to end, from now. */
export const BACKOFF_CEILING_MS = MAX_SUSPEND_MS + RATE_LIMIT_JITTER_MS
/** Timers fire a hair early; a poll this close to the window's end counts as past it. */
export const TIMER_SLACK_MS = 50

const FILE_NAME = 'rate-limit.json'

export type BackoffStore = {
  read(): Promise<SharedBackoff | null>
  write(backoff: SharedBackoff): Promise<void>
  /** Removes the window only while it is still the one ending at `until` (another session may have set a newer). */
  clearIf(until: number): Promise<void>
}

/** Whether a window still holds polling off at `now`. */
export const isInWindow = (backoff: SharedBackoff | null, now: number): boolean => backoff !== null && now + TIMER_SLACK_MS < backoff.until

export const memoryBackoff = (): BackoffStore => {
  let held: SharedBackoff | null = null
  return {
    read: async () => held,
    write: async backoff => void (held = backoff),
    clearIf: async until => void (held = held?.until === until ? null : held),
  }
}

/**
 * The shared window in one file. A file that cannot be written or removed
 * (read-only mount, a root-owned dir, a spawn that timed out) is logged and
 * skipped, never thrown: this process keeps its own window in memory, and
 * `read` answers the later of that and the file's, so a session still honours
 * the limit it met when the dir is unusable.
 */
export const fileBackoff = (fs: CacheFs, dir: () => Promise<string | null>, now: () => Promise<number>, log: (text: string) => void = () => undefined): BackoffStore => {
  const own = memoryBackoff()
  const pathOf = async (): Promise<string | null> => {
    const where = await dir()
    return where === null ? null : `${where}/${FILE_NAME}`
  }
  const attempt = async <T>(what: string, work: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await work()
    } catch (error) {
      log(`github-actions-pane: rate-limit file ${what}: ${error instanceof Error ? error.message : String(error)}`)
      return fallback
    }
  }

  const readFile = async (): Promise<SharedBackoff | null> =>
    attempt(
      'read',
      async () => {
        const path = await pathOf()
        const text = path === null ? null : await fs.read(path)
        return text === null ? null : decodeBackoff(text, (await now()) + BACKOFF_CEILING_MS)
      },
      null,
    )

  return {
    read: async () => {
      const [stored, mine] = await Promise.all([readFile(), own.read()])
      return stored !== null && (mine === null || stored.until >= mine.until) ? stored : mine
    },
    write: async backoff => {
      await own.write(backoff)
      await attempt(
        'write',
        async () => {
          const path = await pathOf()
          if (path !== null) await fs.writeAtomic(path, encodeBackoff(backoff, await now()))
        },
        undefined,
      )
    },
    clearIf: async until => {
      await own.clearIf(until)
      await attempt(
        'remove',
        async () => {
          const path = await pathOf()
          if (path !== null && (await readFile())?.until === until) await fs.remove(path)
        },
        undefined,
      )
    },
  }
}
