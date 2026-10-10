// What the pane draws, from what the poller holds: the runs in scope that are
// active or lingering, each as a card of jobs and steps, plus the header.
// Every decision but the fit to the pane's size is here. Pure.
import type { ActionsData, ActionsJob, ActionsRun, ActionsScope } from '../types'
import { formatDuration, isActiveStatus, type RowStatus, statusOf } from './format'
import { type JobBlock, jobsToBlocks } from './jobs'
import { effectiveScope, isInScope, scopeLabel, shortSha } from './scope'
import type { Settings } from './settings'

export type { JobBlock, Row } from './jobs'

export type Card = {
  id: number
  status: RowStatus
  /** `CI #482`. */
  name: string
  event: string
  /** The commit or PR title, then the short sha (the branch in repo scope). */
  subtitle: string
  durationMs: number | null
  isActive: boolean
  /** Jobs and the steps they show, newest-run-first cards; the layout windows the steps. */
  jobs: JobBlock[]
}

export type Counts = { running: number; failed: number; passed: number }

export type Snapshot = {
  /** The branch, short sha or owner/repo the pane watches; '' while disabled. */
  label: string
  /** `rate limited`, `stale · 40s`, or why the mod is idle; null when all is well. */
  note: string | null
  cards: Card[]
  counts: Counts
  activeIds: number[]
  shownIds: number[]
  /** The runs whose jobs to keep reading: shown as GitHub reports them, before any lag is settled. */
  polledIds: number[]
}

export type SnapshotInputs = {
  data: ActionsData
  now: number
  settings: Settings
  /** The scope in force: the session's `/actions` choice, else the setting. */
  scope: ActionsScope
  /** Opened by `/actions`: shows the latest run when nothing is active. */
  isManual: boolean
}

/** Data older than this many poll intervals is called stale. */
const STALE_POLLS = 2

const FAILED_JOB = new Set(['failure', 'timed_out'])

/** The conclusion the jobs add up to: any failure or timeout, else any cancel, else success. */
const concludeJobs = (jobs: readonly ActionsJob[]): string => {
  if (jobs.some(job => job.conclusion !== null && FAILED_JOB.has(job.conclusion))) return 'failure'
  return jobs.some(job => job.conclusion === 'cancelled') ? 'cancelled' : 'success'
}

/** When the last of these jobs finished; null while any job runs, none were read, or none carries a time. */
const jobsDoneAt = (jobs: readonly ActionsJob[]): number | null => {
  if (jobs.length === 0 || jobs.some(job => job.status !== 'completed')) return null
  const times = jobs.flatMap(job => (job.completedAt === null ? [] : [job.completedAt]))
  return times.length === 0 ? null : Math.max(...times)
}

/**
 * GitHub's run status can trail its jobs by a poll. A run that reports active
 * while every job it has is done is settled from the jobs: concluded by them,
 * its duration frozen at the last job, its linger counted from there (and a
 * later completion by GitHub never restarts it). Pure; the poller still reads
 * the run until GitHub says completed.
 */
const settleLag = (data: ActionsData): ActionsData => {
  const jobsOf = (run: ActionsRun): readonly ActionsJob[] => data.jobs[String(run.id)] ?? []
  const runs = data.runs.map(run => {
    const doneAt = jobsDoneAt(jobsOf(run))
    return isActiveStatus(run.status) && doneAt !== null ? { ...run, status: 'completed', conclusion: concludeJobs(jobsOf(run)), updatedAt: doneAt } : run
  })
  const watched = Object.fromEntries(
    Object.entries(data.watched).map(([id, seen]) => {
      const doneAt = jobsDoneAt(data.jobs[id] ?? [])
      return [id, doneAt === null ? seen : Math.min(seen ?? doneAt, doneAt)]
    }),
  )
  return { ...data, runs, watched }
}

const isLingering = (run: ActionsRun, data: ActionsData, now: number, lingerMs: number): boolean => {
  const doneAt = data.watched[String(run.id)]
  return typeof doneAt === 'number' && now - doneAt < lingerMs
}

const cardOf = (run: ActionsRun, { data, now, scope }: SnapshotInputs): Card => {
  const isActive = isActiveStatus(run.status)
  const start = run.startedAt ?? run.createdAt
  const where = data.context !== null && effectiveScope(scope, data.context) === 'repo' ? run.branch : shortSha(run.sha)
  return {
    id: run.id,
    status: statusOf(run.status, run.conclusion),
    name: `${run.workflow} #${run.number}`,
    event: run.event,
    subtitle: [run.title, where].filter(part => part !== '').join(' · '),
    durationMs: (isActive ? now : run.updatedAt) - start,
    isActive,
    jobs: jobsToBlocks(data.jobs[String(run.id)] ?? [], now),
  }
}

const noteOf = ({ data, now }: SnapshotInputs): string | null => {
  if (data.disabled !== null) return data.disabled
  if (data.isRateLimited) return 'rate limited'
  const age = data.fetchedAt === null ? 0 : now - data.fetchedAt
  return age > STALE_POLLS * data.pollMs ? `stale · ${formatDuration(age)}` : null
}

const countsOf = (cards: readonly Card[]): Counts => ({
  running: cards.filter(card => card.isActive).length,
  failed: cards.filter(card => card.status === 'failure').length,
  passed: cards.filter(card => card.status === 'success').length,
})

/** The runs to draw: active or lingering in scope; by hand with none, the latest. */
const shownRuns = (inputs: SnapshotInputs): ActionsRun[] => {
  const { data, now, settings, scope, isManual } = inputs
  const context = data.context
  if (context === null || data.disabled !== null) return []
  const inScope = [...data.runs].filter(run => isInScope(run, scope, context)).sort((a, b) => b.createdAt - a.createdAt)
  const shown = inScope.filter(run => isActiveStatus(run.status) || isLingering(run, data, now, settings.lingerMs))
  return shown.length === 0 && isManual ? inScope.slice(0, 1) : shown
}

export const buildSnapshot = (raw: SnapshotInputs): Snapshot => {
  const inputs = { ...raw, data: settleLag(raw.data) }
  const { data, scope } = inputs
  const cards = shownRuns(inputs).map(run => cardOf(run, inputs))
  const polledIds = shownRuns(raw).map(run => run.id)
  return {
    label: data.context === null || data.disabled !== null ? '' : scopeLabel(scope, data.context),
    note: noteOf(inputs),
    cards,
    counts: countsOf(cards),
    activeIds: cards.filter(card => card.isActive).map(card => card.id),
    shownIds: cards.map(card => card.id),
    polledIds,
  }
}
