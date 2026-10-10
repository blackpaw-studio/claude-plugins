// A run's jobs to the rows its card draws: steps for the running and failed
// jobs only, long step lists windowed, many passed jobs folded. Pure.
import type { ActionsJob, ActionsStep } from '../types'
import { type RowStatus, statusOf } from './format'

/** One row under a run: a job (depth 0) or a step (depth 1); a summary folds several. */
export type Row = {
  depth: 0 | 1
  status: RowStatus
  name: string
  durationMs: number | null
  isSummary?: true
}

/** Past this many jobs the passed ones fold into one row. */
const JOB_FOLD_THRESHOLD = 8
/** Past this many steps a running job shows a window around its current step. */
const STEP_WINDOW_THRESHOLD = 8
const STEPS_BEFORE = 2
const STEPS_AFTER = 3

/** Start to completion, or to now while it runs; null before it starts. */
export const spanOf = (startedAt: number | null, completedAt: number | null, isRunning: boolean, now: number): number | null => {
  if (startedAt === null) return null
  if (completedAt !== null) return completedAt - startedAt
  return isRunning ? now - startedAt : null
}

const stepRow = (step: ActionsStep, now: number): Row => {
  const status = statusOf(step.status, step.conclusion)
  return { depth: 1, status, name: step.name, durationMs: spanOf(step.startedAt, step.completedAt, status === 'running', now) }
}

const summary = (depth: 0 | 1, status: RowStatus, name: string): Row => ({ depth, status, name, durationMs: null, isSummary: true })

/** A fold of hidden steps: failed if any hidden step failed. */
const foldOf = (rows: readonly Row[], name: string, fallback: RowStatus): Row =>
  summary(1, rows.some(row => row.status === 'failure') ? 'failure' : fallback, name)

/** Every step, or a window around the first unfinished one; a fold of one is the step itself. */
const windowSteps = (rows: readonly Row[]): Row[] => {
  if (rows.length <= STEP_WINDOW_THRESHOLD) return [...rows]
  const found = rows.findIndex(row => row.status === 'running' || row.status === 'queued')
  const current = found === -1 ? rows.length - 1 : found
  const from = Math.max(0, current - STEPS_BEFORE)
  const to = Math.min(rows.length, current + STEPS_AFTER + 1)
  const before = rows.slice(0, from)
  const after = rows.slice(to)
  return [
    ...(before.length > 1 ? [foldOf(before, `${before.length} steps`, 'success')] : before),
    ...rows.slice(from, to),
    ...(after.length > 1 ? [foldOf(after, `${after.length} more`, 'queued')] : after),
  ]
}

const stepsOf = (job: ActionsJob, status: RowStatus, now: number): Row[] => {
  if (status === 'running') return windowSteps(job.steps.map(step => stepRow(step, now)))
  if (status === 'failure') return job.steps.map(step => stepRow(step, now)).filter(row => row.status === 'failure')
  return []
}

const jobRows = (job: ActionsJob, now: number): Row[] => {
  const status = statusOf(job.status, job.conclusion)
  const row: Row = { depth: 0, status, name: job.name, durationMs: spanOf(job.startedAt, job.completedAt, status === 'running', now) }
  return [row, ...stepsOf(job, status, now)]
}

export const jobsToRows = (jobs: readonly ActionsJob[], now: number): Row[] => {
  const passed = jobs.filter(job => statusOf(job.status, job.conclusion) === 'success')
  const isFolded = jobs.length > JOB_FOLD_THRESHOLD && passed.length > 0
  const shown = isFolded ? jobs.filter(job => !passed.includes(job)) : jobs
  const fold = isFolded ? [summary(0, 'success', `${passed.length} jobs passed`)] : []
  return [...fold, ...shown.flatMap(job => jobRows(job, now))]
}
