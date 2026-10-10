// Small builders over the contract's shapes, for tests that need a run or a
// job in one state. Realistic defaults; the fixtures hold the real gh shapes.
import type { ActionsData, ActionsJob, ActionsRun, ActionsStep } from '../../types'

export const T0 = Date.parse('2026-10-09T18:00:00Z')
export const SECOND = 1000
export const MINUTE = 60 * SECOND

export const runOf = (fields: Partial<ActionsRun> = {}): ActionsRun => ({
  id: 482,
  number: 482,
  workflow: 'CI',
  workflowId: 1234,
  title: 'fix: parser edge case',
  event: 'push',
  status: 'in_progress',
  conclusion: null,
  branch: 'main',
  sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  createdAt: T0,
  startedAt: T0,
  updatedAt: T0,
  url: `https://github.com/acme/widgets/actions/runs/${fields.id ?? 482}`,
  ...fields,
})

export const stepOf = (name: string, fields: Partial<ActionsStep> = {}): ActionsStep => ({
  name,
  number: 1,
  status: 'completed',
  conclusion: 'success',
  startedAt: T0,
  completedAt: T0 + SECOND,
  ...fields,
})

export const jobOf = (name: string, fields: Partial<ActionsJob> = {}): ActionsJob => ({
  id: 9000,
  name,
  status: 'completed',
  conclusion: 'success',
  startedAt: T0,
  completedAt: T0 + 18 * SECOND,
  url: 'https://github.com/acme/widgets/actions/runs/482/job/9000',
  steps: [],
  ...fields,
})

export const dataOf = (fields: Partial<ActionsData> = {}): ActionsData => ({
  context: { cwd: '/r', branch: 'main', sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', repo: 'acme/widgets' },
  runs: [],
  jobs: {},
  watched: {},
  history: {},
  fetchedAt: null,
  pollMs: 10_000,
  isRateLimited: false,
  disabled: null,
  ...fields,
})

const iso = (ms: number | null): string => (ms === null ? '0001-01-01T00:00:00Z' : new Date(ms).toISOString().replace('.000Z', 'Z'))

/** A run as `gh run list --json …` prints it. */
export const ghRun = (run: ActionsRun) => ({
  databaseId: run.id,
  number: run.number,
  workflowName: run.workflow,
  workflowDatabaseId: run.workflowId,
  displayTitle: run.title,
  event: run.event,
  status: run.status,
  conclusion: run.conclusion ?? '',
  headBranch: run.branch,
  headSha: run.sha,
  createdAt: iso(run.createdAt),
  startedAt: iso(run.startedAt),
  updatedAt: iso(run.updatedAt),
  url: run.url,
})

const ghStep = (step: ActionsStep) => ({
  name: step.name,
  number: step.number,
  status: step.status,
  conclusion: step.conclusion ?? '',
  startedAt: iso(step.startedAt),
  completedAt: iso(step.completedAt),
})

/** Jobs as `gh run view --json jobs` prints them. */
export const ghJobs = (jobs: readonly ActionsJob[]) => ({
  jobs: jobs.map(job => ({
    databaseId: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion ?? '',
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
    url: job.url,
    steps: job.steps.map(ghStep),
  })),
})
