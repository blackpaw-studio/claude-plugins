// Pure text formatters: token counts, durations, paths, model names, cost.

const MINUTE_MS = 60_000
const HOUR_MINUTES = 60
const DAY_MINUTES = 24 * HOUR_MINUTES

const trimZero = (text: string): string => text.replace(/\.0$/, '')

/** `850`, `6.4k`, `28k`, `1M`, `1.3M`. */
export const formatTokens = (tokens: number): string => {
  const n = Math.max(0, Math.round(tokens))
  if (n < 1_000) return String(n)
  if (n < 9_950) return `${(n / 1_000).toFixed(1)}k`
  const thousands = Math.round(n / 1_000)
  if (thousands < 1_000) return `${thousands}k`
  return `${trimZero((n / 1_000_000).toFixed(1))}M`
}

type Parts = { days: number; hours: number; minutes: number }

const durationParts = (ms: number): Parts => {
  const total = Math.max(0, Math.floor(ms / MINUTE_MS))
  return {
    days: Math.floor(total / DAY_MINUTES),
    hours: Math.floor((total % DAY_MINUTES) / HOUR_MINUTES),
    minutes: total % HOUR_MINUTES,
  }
}

/** `1d 12h 11m`, `1h 11m`, `11m`. */
export const formatDuration = (ms: number): string => {
  const { days, hours, minutes } = durationParts(ms)
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/** `1d12h`, `1h11m`, `11m`. */
export const formatDurationCompact = (ms: number): string => {
  const { days, hours, minutes } = durationParts(ms)
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${minutes}m`
  return `${minutes}m`
}

const shrinkSegment = (segment: string): string =>
  segment.startsWith('.') ? segment.slice(0, 2) : segment.slice(0, 1)

const shrinkSegments = (segments: readonly string[]): string[] =>
  segments.map((segment, index) => (index === segments.length - 1 ? segment : shrinkSegment(segment)))

const relativeToHome = (path: string, home: string | undefined): string[] | null => {
  if (home === undefined || home === '') return null
  const root = home.replace(/\/+$/, '')
  if (path === root) return []
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1).split('/').filter(Boolean) : null
}

/** `~/.l/workspace`: home to `~`, middle segments to one char, the last kept. */
export const abbreviatePath = (path: string, home: string | undefined): string => {
  const underHome = relativeToHome(path, home)
  if (underHome !== null) {
    return underHome.length === 0 ? '~' : `~/${shrinkSegments(underHome).join('/')}`
  }
  const segments = path.split('/').filter(Boolean)
  return `/${shrinkSegments(segments).join('/')}`
}

const MODEL_PATTERN = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/

/** `claude-opus-5-5` to `Opus 5.5`; anything else unchanged. */
export const displayModel = (id: string): string => {
  const match = MODEL_PATTERN.exec(id.trim())
  if (match === null) return id
  const [, family = '', major = '', minor] = match
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  return minor === undefined ? `${name} ${major}` : `${name} ${major}.${minor}`
}

export const formatCost = (usd: number): string => `$${usd.toFixed(2)}`

export const shortEffort = (effort: string): string => (effort === 'medium' ? 'med' : effort)
