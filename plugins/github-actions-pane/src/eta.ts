// A run's time remaining, estimated from how long the workflow's past
// successful runs took. Pure.
import { formatDuration } from './format'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

/** Fewer past runs than this say too little about how long the next takes. */
export const MIN_SAMPLES = 3

const medianOf = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

/** The median of past durations less the elapsed time (negative once over); null with too few samples. */
export const estimateEta = (samples: readonly number[], elapsedMs: number): number | null =>
  samples.length < MIN_SAMPLES ? null : medianOf(samples) - elapsedMs

/** `~2m left` (minutes rounded up), `~1h 04m left`, `<1m left`, or `over est.`. */
export const etaLabel = (remainingMs: number): string => {
  if (remainingMs <= 0) return 'over est.'
  if (remainingMs < MINUTE) return '<1m left'
  const minutes = Math.ceil(remainingMs / MINUTE)
  return minutes * MINUTE >= HOUR ? `~${formatDuration(minutes * MINUTE)} left` : `~${minutes}m left`
}
