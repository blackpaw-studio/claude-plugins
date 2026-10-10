// How one poll's answers fold into what the poller holds. Pure.
import type { ActionsData, ActionsJob, ActionsRun } from '../types'
import { isActiveStatus } from './format'

export const EMPTY_DATA: ActionsData = {
  context: null,
  runs: [],
  jobs: {},
  watched: {},
  history: {},
  fetchedAt: null,
  pollMs: 0,
  isRateLimited: false,
  disabled: null,
}

/**
 * The history kept for the workflows among `runs`, less those with a run seen
 * finishing in this list (it is a new sample: read again when next needed).
 */
const historyAfter = (data: ActionsData, runs: readonly ActionsRun[]): ActionsData['history'] => {
  const finishing = new Set(runs.filter(run => !isActiveStatus(run.status) && data.watched[String(run.id)] === null).map(run => run.workflowId))
  const inView = new Set(runs.map(run => run.workflowId))
  return Object.fromEntries(Object.entries(data.history).filter(([id]) => inView.has(Number(id)) && !finishing.has(Number(id))))
}

/**
 * A fresh list: active runs are watched (null), a watched run seen finished
 * for the first time gets its completion time, and runs no longer listed are
 * forgotten along with their jobs. Workflow history follows the runs in view.
 */
export const withRuns = (data: ActionsData, runs: readonly ActionsRun[], now: number): ActionsData => {
  const watched = Object.fromEntries(
    runs.flatMap((run): [string, number | null][] => {
      const key = String(run.id)
      if (isActiveStatus(run.status)) return [[key, null]]
      const seen = data.watched[key]
      return seen === undefined ? [] : [[key, seen ?? now]]
    }),
  )
  const listed = new Set(runs.map(run => String(run.id)))
  const jobs = Object.fromEntries(Object.entries(data.jobs).filter(([id]) => listed.has(id)))
  return { ...data, runs: [...runs], watched, jobs, history: historyAfter(data, runs), fetchedAt: now, isRateLimited: false }
}

/**
 * The runs whose jobs to ask for: shown and active, or shown, finished and
 * not yet read since finishing (`final` holds those that were).
 */
export const runsToDetail = (data: ActionsData, shownIds: readonly number[], final: ReadonlySet<number>): number[] =>
  shownIds.filter(id => {
    const run = data.runs.find(one => one.id === id)
    return run !== undefined && (isActiveStatus(run.status) || !final.has(id))
  })

export const withJobs = (data: ActionsData, answers: ReadonlyMap<number, readonly ActionsJob[]>): ActionsData =>
  answers.size === 0
    ? data
    : { ...data, jobs: { ...data.jobs, ...Object.fromEntries([...answers].map(([id, jobs]) => [String(id), [...jobs]])) } }

/** The workflows to read past durations for: those of active runs, not read yet. */
export const workflowsToRead = (data: ActionsData): number[] => {
  const ids = data.runs.flatMap(run => (isActiveStatus(run.status) && run.workflowId !== null && data.history[String(run.workflowId)] === undefined ? [run.workflowId] : []))
  return ids.filter((id, index) => ids.indexOf(id) === index)
}

export const withHistory = (data: ActionsData, answers: ReadonlyMap<number, readonly number[]>): ActionsData =>
  answers.size === 0
    ? data
    : { ...data, history: { ...data.history, ...Object.fromEntries([...answers].map(([id, durations]) => [String(id), [...durations]])) } }
