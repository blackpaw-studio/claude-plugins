// How tightly a running job's steps are drawn: every step, or a window around
// the current one with the rest folded, tightening until the pane fits. Pure.
import { type JobBlock, type Row, summaryRow } from './jobs'

/** Steps kept before and after the current one; `all` keeps every step, `none` hides them. */
export type Window = 'all' | 'none' | { before: number; after: number }

/** From roomiest to tightest; the layout takes the first that fits. */
export const WINDOWS: readonly Window[] = ['all', { before: 2, after: 3 }, { before: 1, after: 1 }, { before: 0, after: 0 }, 'none']

/** A fold of hidden steps: failed if any hidden step failed. */
const foldOf = (rows: readonly Row[], name: string, fallback: Row['status']): Row =>
  summaryRow(1, rows.some(row => row.status === 'failure') ? 'failure' : fallback, name)

/** The steps around the first unfinished one; a fold of one step is that step. */
export const windowSteps = (steps: readonly Row[], window: Window): Row[] => {
  if (window === 'all') return [...steps]
  if (window === 'none') return []
  const found = steps.findIndex(row => row.status === 'running' || row.status === 'queued')
  const current = found === -1 ? steps.length - 1 : found
  const from = Math.max(0, current - window.before)
  const to = Math.min(steps.length, current + window.after + 1)
  const before = steps.slice(0, from)
  const after = steps.slice(to)
  return [
    ...(before.length > 1 ? [foldOf(before, `${before.length} steps`, 'success')] : before),
    ...steps.slice(from, to),
    ...(after.length > 1 ? [foldOf(after, `${after.length} more`, 'queued')] : after),
  ]
}

/** A card's rows at a window: running jobs windowed, a failed job's steps always whole. */
export const rowsAt = (jobs: readonly JobBlock[], window: Window): Row[] =>
  jobs.flatMap(({ row, steps }) => [row, ...(row.status === 'running' ? windowSteps(steps, window) : steps)])
