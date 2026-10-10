// A run's jobs to the blocks its card draws: every step of a running job,
// only the failed step of a failed job, none for the rest; more than eight
// jobs fold the passed ones into one row. Pure.
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

/** A job's row and the steps it shows; the layout windows a running job's steps to fit. */
export type JobBlock = { row: Row; steps: Row[] }

/** Past this many jobs the passed ones fold into one row. */
const JOB_FOLD_THRESHOLD = 8

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

export const summaryRow = (depth: 0 | 1, status: RowStatus, name: string): Row => ({ depth, status, name, durationMs: null, isSummary: true })

const stepsOf = (job: ActionsJob, status: RowStatus, now: number): Row[] => {
  if (status === 'running') return job.steps.map(step => stepRow(step, now))
  if (status === 'failure') return job.steps.map(step => stepRow(step, now)).filter(row => row.status === 'failure')
  return []
}

const blockOf = (job: ActionsJob, now: number): JobBlock => {
  const status = statusOf(job.status, job.conclusion)
  const row: Row = { depth: 0, status, name: job.name, durationMs: spanOf(job.startedAt, job.completedAt, status === 'running', now) }
  return { row, steps: stepsOf(job, status, now) }
}

export const jobsToBlocks = (jobs: readonly ActionsJob[], now: number): JobBlock[] => {
  const passed = jobs.filter(job => statusOf(job.status, job.conclusion) === 'success')
  const isFolded = jobs.length > JOB_FOLD_THRESHOLD && passed.length > 0
  const shown = isFolded ? jobs.filter(job => !passed.includes(job)) : jobs
  const fold: JobBlock[] = isFolded ? [{ row: summaryRow(0, 'success', `${passed.length} jobs passed`), steps: [] }] : []
  return [...fold, ...shown.map(job => blockOf(job, now))]
}
