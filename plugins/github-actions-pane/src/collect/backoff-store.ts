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

export const fileBackoff = (fs: CacheFs, dir: () => Promise<string | null>, now: () => Promise<number>): BackoffStore => {
  const fallback = memoryBackoff()
  const pathOf = async (): Promise<string | null> => {
    const where = await dir()
    return where === null ? null : `${where}/${FILE_NAME}`
  }

  const read = async (): Promise<SharedBackoff | null> => {
    const path = await pathOf()
    if (path === null) return fallback.read()
    const text = await fs.read(path)
    return text === null ? null : decodeBackoff(text, (await now()) + BACKOFF_CEILING_MS)
  }

  return {
    read,
    write: async backoff => {
      const path = await pathOf()
      if (path === null) return fallback.write(backoff)
      await fs.writeAtomic(path, encodeBackoff(backoff, await now()))
    },
    clearIf: async until => {
      const path = await pathOf()
      if (path === null) return fallback.clearIf(until)
      if ((await read())?.until === until) await fs.remove(path)
    },
  }
}
