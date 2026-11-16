// The shared cache's file formats, pure: keys, entries, locks, the shared
// rate-limit window and the cache directory. Everything read from disk is
// external input and validated; anything off decodes to null (a miss).

export const FORMAT_VERSION = 1
/** A timer fires a hair early: an entry this close to expiry counts as expired, so a poll never reads its own last write. */
export const FRESH_SLACK_MS = 1000
/** A kick wants news: it accepts only an entry this young (absorbs the kicks several sessions fire for one push). */
export const KICK_FRESH_MS = 3000
/** A lock older than this is a crashed holder's (gh's own timeout is 10s). */
export const LOCK_STALE_MS = 30_000
const DIR_NAME = 'github-actions-pane'

/** How much staleness a call tolerates: the caller's cadence, and whether it is a kick. */
export type Freshness = { maxAgeMs: number; isKick: boolean }

export type CacheEntry = { host: string; argv: readonly string[]; at: number; stdout: string }
export type Lock = { pid: number | null; at: number; token: string }
export type SharedBackoff = { until: number; attempts: number; limit: 'primary' | 'secondary' }

type Fields = Record<string, unknown>

const parse = (text: string): Fields | null => {
  try {
    const value: unknown = JSON.parse(text)
    const isObject = typeof value === 'object' && value !== null && !Array.isArray(value)
    return isObject && (value as Fields).v === FORMAT_VERSION ? (value as Fields) : null
  } catch {
    return null
  }
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const isSameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((item, index) => item === b[index])

const FNV_OFFSET = BigInt('0xcbf29ce484222325')
const FNV_PRIME = BigInt('0x100000001b3')

/** FNV-1a, 64 bit, as 16 hex digits. Not secret: a collision is only a miss, since entries carry their argv. */
export const cacheKey = (host: string, argv: readonly string[]): string => {
  const text = [host, ...argv].join('\0')
  let hash = FNV_OFFSET
  for (let index = 0; index < text.length; index += 1) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(index))) * FNV_PRIME)
  }
  return hash.toString(16).padStart(16, '0')
}

export const encodeEntry = (entry: CacheEntry): string =>
  JSON.stringify({ v: FORMAT_VERSION, host: entry.host, argv: entry.argv, at: entry.at, stdout: entry.stdout })

/** The entry in `text` if it answers exactly this host and argv; else null. */
export const decodeEntry = (text: string, host: string, argv: readonly string[]): CacheEntry | null => {
  const fields = parse(text)
  if (fields === null) return null
  const { host: storedHost, argv: storedArgv, at, stdout } = fields
  if (storedHost !== host || !isStringList(storedArgv) || !isSameList(storedArgv, argv)) return null
  if (!isFiniteNumber(at) || typeof stdout !== 'string') return null
  return { host, argv: storedArgv, at, stdout }
}

export const isFresh = (entry: CacheEntry, now: number, fresh: Freshness): boolean => {
  const age = now - entry.at
  if (age < 0) return false
  return fresh.isKick ? age < KICK_FRESH_MS : age < fresh.maxAgeMs - FRESH_SLACK_MS
}

export const encodeLock = (lock: Lock): string => JSON.stringify({ v: FORMAT_VERSION, pid: lock.pid, at: lock.at, token: lock.token })

export const decodeLock = (text: string): Lock | null => {
  const fields = parse(text)
  if (fields === null) return null
  const { pid, at, token } = fields
  const isPidOk = pid === null || (typeof pid === 'number' && Number.isInteger(pid) && pid > 0)
  if (!isPidOk || !isFiniteNumber(at) || typeof token !== 'string') return null
  return { pid: pid as number | null, at, token }
}

/** Held by nobody who can still be fetching: too old, its process gone, or unreadable (null). */
export const isLockStale = async (lock: Lock | null, now: number, isAlive: (pid: number) => Promise<boolean>): Promise<boolean> => {
  if (lock === null || now - lock.at > LOCK_STALE_MS) return true
  return lock.pid !== null && !(await isAlive(lock.pid))
}

const trimSlashes = (path: string): string => path.replace(/\/+$/, '')
const isAbsolute = (path: string | undefined): path is string => path !== undefined && path.startsWith('/')

/** `$XDG_CACHE_HOME` counts only when absolute; null when there is no usable place (the cache is then off). */
export const cacheDir = ({ xdg, home }: { xdg: string | undefined; home: string | undefined }): string | null => {
  if (isAbsolute(xdg)) return [trimSlashes(xdg), DIR_NAME].join('/')
  return isAbsolute(home) ? [trimSlashes(home), '.cache', DIR_NAME].join('/') : null
}

export const encodeBackoff = (backoff: SharedBackoff, at: number): string =>
  JSON.stringify({ v: FORMAT_VERSION, until: backoff.until, attempts: backoff.attempts, limit: backoff.limit, at })

/** The shared window in `text`, `until` clamped to `ceiling` (a skewed or hostile file can't park every session for good); null when corrupt. */
export const decodeBackoff = (text: string, ceiling: number): SharedBackoff | null => {
  const fields = parse(text)
  if (fields === null) return null
  const { until, attempts, limit } = fields
  if (!isFiniteNumber(until) || typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 1) return null
  if (limit !== 'primary' && limit !== 'secondary') return null
  return { until: Math.min(until, ceiling), attempts, limit }
}
