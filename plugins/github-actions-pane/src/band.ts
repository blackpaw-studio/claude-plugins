// The one-line band above the prompt: what is running, or what just failed.
// Drawn from the same snapshot as the pane, whose linger already decides how
// long a finished run stays. Pure.
import { etaLabel } from './eta'
import { formatDuration } from './format'
import { buildSnapshot, type Card, type Snapshot, type SnapshotInputs } from './snapshot'

const RUNNING_GLYPH = '⟳'
const FAILED_GLYPH = '✗'

const maxOf = (values: readonly number[]): number | null => (values.length === 0 ? null : Math.max(...values))

const runningText = (running: readonly Card[]): string => {
  const left = maxOf(running.flatMap(card => card.remainingMs ?? []))
  const time = left !== null ? etaLabel(left) : formatDuration(maxOf(running.flatMap(card => card.durationMs ?? [])))
  return `${RUNNING_GLYPH} ${running.length} running${time === '' ? '' : ` · ${time}`}`
}

const failedText = (failed: readonly Card[]): string =>
  failed.length === 1 ? `${FAILED_GLYPH} ${failed[0]?.name} failed` : `${FAILED_GLYPH} ${failed.length} failed`

/** The band's text, or null when nothing is worth a line (a rate-limited or idle poller says nothing). */
export const bandText = (snapshot: Snapshot): string | null => {
  if (snapshot.note === 'rate limited' || snapshot.cards.length === 0) return null
  const running = snapshot.cards.filter(card => card.isActive)
  if (running.length > 0) return runningText(running)
  const failed = snapshot.cards.filter(card => card.status === 'failure')
  return failed.length > 0 ? failedText(failed) : null
}

/** Whether the band's text is the running state (the failure state is not). */
export const isRunningBand = (text: string | null): boolean => text?.startsWith(RUNNING_GLYPH) === true

/** The band for these inputs: never the pane's manual "latest run" fallback. */
export const bandAt = (inputs: Omit<SnapshotInputs, 'isManual'>): string | null =>
  bandText(buildSnapshot({ ...inputs, isManual: false }))
