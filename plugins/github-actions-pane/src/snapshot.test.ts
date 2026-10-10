import { describe, expect, test } from 'claude-code/testing'
import type { ActionsJob } from '../types'
import { parseJobs, parseRuns } from './collect/gh'
import { DEFAULT_SETTINGS } from './settings'
import { buildSnapshot, type Card, type Row, type SnapshotInputs } from './snapshot'
import { rowsAt } from './window'
import { dataOf, jobOf, MINUTE, runOf, SECOND, stepOf, T0 } from './testing/builders'
import { JOBS_IN_PROGRESS, JOBS_LINT_FAILED, RUN_LIST } from './testing/gh-fixtures'

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const NOW = T0 + 72 * SECOND
/** Just after the builders' jobs finish (T0 + 18s), inside a run's linger. */
const SOON = T0 + 20 * SECOND

const inputs = (fields: Partial<SnapshotInputs> = {}): SnapshotInputs => ({
  data: dataOf(),
  now: NOW,
  settings: DEFAULT_SETTINGS,
  scope: 'branch',
  isManual: false,
  ...fields,
})

const rowText = (row: Row): string =>
  `${'  '.repeat(row.depth)}${row.status} ${row.name}${row.durationMs === null ? '' : ` ${row.durationMs / SECOND}s`}`
const rowsOf = (card: Card | undefined): string[] => rowsAt(card?.jobs ?? [], 'all').map(rowText)
const jobsOf = (json: string): ActionsJob[] => parseJobs(json) ?? []

describe('which runs are shown', () => {
  const onMain = runOf({ id: 1, branch: 'main' })
  const onFeature = runOf({ id: 2, branch: 'feature', sha: 'f'.repeat(40) })
  const doneOnMain = runOf({ id: 3, status: 'completed', conclusion: 'success', createdAt: T0 - MINUTE })

  test('branch scope: the active runs on the branch', () => {
    const snapshot = buildSnapshot(inputs({ data: dataOf({ runs: [onMain, onFeature, doneOnMain] }) }))
    expect(snapshot.cards.map(card => card.id)).toEqual([1])
    expect(snapshot.activeIds).toEqual([1])
  })

  test('repo scope: every active run; commit scope: HEAD only', () => {
    const data = dataOf({ runs: [onMain, onFeature] })
    expect(buildSnapshot(inputs({ data, scope: 'repo' })).cards.map(card => card.id)).toEqual([1, 2])
    expect(buildSnapshot(inputs({ data, scope: 'commit' })).cards.map(card => card.id)).toEqual([1])
  })

  test('a detached HEAD under branch scope follows the commit', () => {
    const data = dataOf({ runs: [onMain, onFeature], context: { cwd: '/r', branch: null, sha: 'f'.repeat(40), repo: 'acme/widgets' } })
    const snapshot = buildSnapshot(inputs({ data }))
    expect(snapshot.cards.map(card => card.id)).toEqual([2])
    expect(snapshot.label).toBe('fffffff')
  })

  test('a run already finished when first seen never surfaces', () => {
    expect(buildSnapshot(inputs({ data: dataOf({ runs: [doneOnMain] }) })).cards).toEqual([])
  })

  test('a watched run stays shown for the linger window after its completion was seen', () => {
    const data = dataOf({ runs: [doneOnMain], watched: { 3: NOW } })
    const at = (ms: number) => buildSnapshot(inputs({ data, now: NOW + ms })).cards.map(card => card.id)
    expect(at(0)).toEqual([3])
    expect(at(29_999)).toEqual([3])
    expect(at(30_000)).toEqual([])
    expect(buildSnapshot(inputs({ data, settings: { ...DEFAULT_SETTINGS, lingerMs: 0 } })).cards).toEqual([])
  })

  test('newest first, by creation', () => {
    const older = runOf({ id: 5, createdAt: T0 - MINUTE })
    const newer = runOf({ id: 6, createdAt: T0 })
    expect(buildSnapshot(inputs({ data: dataOf({ runs: [older, newer] }) })).cards.map(card => card.id)).toEqual([6, 5])
  })

  test('opened by hand with nothing active: the latest run in scope', () => {
    const data = dataOf({ runs: [doneOnMain, runOf({ id: 4, status: 'completed', conclusion: 'failure', createdAt: T0 - 2 * MINUTE })] })
    expect(buildSnapshot(inputs({ data, isManual: true })).cards.map(card => card.id)).toEqual([3])
    expect(buildSnapshot(inputs({ data, isManual: false })).cards).toEqual([])
  })
})

describe('the run card', () => {
  test('names the workflow, number and event; links the run; elapsed while running', () => {
    const [card] = buildSnapshot(inputs({ data: dataOf({ runs: [runOf()] }) })).cards
    expect(card).toMatchObject({
      id: 482,
      status: 'running',
      name: 'CI #482',
      event: 'push',
      subtitle: 'fix: parser edge case · a1b2c3d',
      durationMs: 72 * SECOND,
      isActive: true,
    })
  })

  test('a finished run lasts from start to its last update; repo scope names the branch', () => {
    const run = runOf({ status: 'completed', conclusion: 'failure', updatedAt: T0 + 3 * MINUTE + 2 * SECOND })
    const data = dataOf({ runs: [run], watched: { 482: NOW } })
    const [card] = buildSnapshot(inputs({ data, scope: 'repo' })).cards
    expect(card).toMatchObject({ status: 'failure', durationMs: 182 * SECOND, isActive: false, subtitle: 'fix: parser edge case · main' })
  })

  test('the real list: a queued run waits as queued', () => {
    const runs = parseRuns(RUN_LIST) ?? []
    const context = { cwd: '/r', branch: 'trunk', sha: runs[0]?.sha ?? '', repo: 'cli/cli' }
    const [card] = buildSnapshot(inputs({ data: dataOf({ runs, context }), now: Date.parse('2026-10-10T02:02:12Z') })).cards
    expect(card).toMatchObject({ status: 'queued', name: 'Dependabot PR Triage (skills-driven) #1637', event: 'schedule', durationMs: 12 * SECOND })
  })
})

describe('jobs and steps', () => {
  const RUN = runOf({ id: 482 })

  test('a running job shows every step; a passed job is one line (real mid-run jobs)', () => {
    const data = dataOf({ runs: [RUN], jobs: { 482: jobsOf(JOBS_IN_PROGRESS) } })
    const now = Date.parse('2026-10-10T02:04:40Z')
    expect(rowsOf(buildSnapshot(inputs({ data, now })).cards[0])).toEqual([
      'success activation 31s',
      'success agent 55s',
      'running detection 62s',
      '  success Set up job 2s',
      '  success Setup Scripts 2s',
      '  success Download activation artifact 2s',
      '  success Ensure threat-detection directory and log 0s',
      '  success Install AWF binary 1s',
      '  running Install GitHub Copilot CLI 42s',
      '  queued Install threat-detect binary',
      '  queued Execute threat detection with AWF',
      '  queued Render detection log',
      '  queued Post Setup Scripts',
    ])
  })

  test('a failed job shows only its failed step (real failed run)', () => {
    const run = { ...RUN, status: 'completed', conclusion: 'failure' }
    const data = dataOf({ runs: [run], jobs: { 482: jobsOf(JOBS_LINT_FAILED) }, watched: { 482: NOW } })
    expect(rowsOf(buildSnapshot(inputs({ data })).cards[0])).toEqual([
      'success lint 163s',
      'failure govulncheck 33s',
      '  failure Check Go vulnerabilities 12s',
    ])
  })

  test('a short running job shows every step, the first unstarted one queued', () => {
    const job = jobOf('test (node 20)', {
      status: 'in_progress',
      conclusion: null,
      completedAt: null,
      steps: [
        stepOf('Set up job', { number: 1 }),
        stepOf('Run tests', { number: 2, status: 'in_progress', conclusion: null, completedAt: null }),
        stepOf('Post checkout', { number: 3, status: 'pending', conclusion: null, startedAt: null, completedAt: null }),
      ],
    })
    const data = dataOf({ runs: [RUN], jobs: { 482: [job, jobOf('build', { status: 'queued', conclusion: null, startedAt: null, completedAt: null })] } })
    expect(rowsOf(buildSnapshot(inputs({ data })).cards[0])).toEqual([
      'running test (node 20) 72s',
      '  success Set up job 1s',
      '  running Run tests 72s',
      '  queued Post checkout',
      'queued build',
    ])
  })

  test('more than eight jobs: the passed ones fold into one row', () => {
    const passed = Array.from({ length: 12 }, (_, i) => jobOf(`shard ${i + 1}`, { id: i }))
    const failing = jobOf('lint', { id: 99, conclusion: 'failure', steps: [stepOf('golangci-lint', { conclusion: 'failure' })] })
    const data = dataOf({ runs: [RUN], jobs: { 482: [...passed.slice(0, 6), failing, ...passed.slice(6)] }, watched: { 482: null } })
    expect(rowsOf(buildSnapshot(inputs({ data, now: SOON })).cards[0])).toEqual([
      'success 12 jobs passed',
      'failure lint 18s',
      '  failure golangci-lint 1s',
    ])
  })

  test('eight jobs or fewer stay listed', () => {
    const jobs = Array.from({ length: 8 }, (_, i) => jobOf(`shard ${i + 1}`, { id: i }))
    expect(rowsOf(buildSnapshot(inputs({ data: dataOf({ runs: [RUN], jobs: { 482: jobs }, watched: { 482: null } }), now: SOON })).cards[0])).toHaveLength(8)
  })
})

describe('the header and counts', () => {
  test('labels the scope and counts what is shown', () => {
    const runs = [
      runOf({ id: 1 }),
      runOf({ id: 2, status: 'completed', conclusion: 'failure' }),
      runOf({ id: 3, status: 'completed', conclusion: 'success' }),
    ]
    const snapshot = buildSnapshot(inputs({ data: dataOf({ runs, watched: { 1: null, 2: NOW, 3: NOW } }) }))
    expect(snapshot.label).toBe('main')
    expect(snapshot.note).toBe(null)
    expect(snapshot.counts).toEqual({ running: 1, failed: 1, passed: 1 })
    expect(snapshot.shownIds).toEqual([1, 2, 3])
  })

  test('rate limited, else stale once the data is two polls old', () => {
    expect(buildSnapshot(inputs({ data: dataOf({ isRateLimited: true }) })).note).toBe('rate limited')
    const fetchedAt = NOW - 40 * SECOND
    expect(buildSnapshot(inputs({ data: dataOf({ fetchedAt, pollMs: 10_000 }) })).note).toBe('stale · 40s')
    expect(buildSnapshot(inputs({ data: dataOf({ fetchedAt, pollMs: 20_000 }) })).note).toBe(null)
  })

  test('disabled: the reason, nothing shown', () => {
    const snapshot = buildSnapshot(inputs({ data: dataOf({ disabled: 'no GitHub remote', context: null, runs: [runOf()] }) }))
    expect(snapshot).toMatchObject({ label: '', note: 'no GitHub remote', cards: [] })
  })
})

describe('a run header that lags its jobs', () => {
  // GitHub's run status can trail the jobs by a poll: every job is done, the run still says in_progress.
  const lagging = runOf({ id: 482, status: 'in_progress', startedAt: T0, updatedAt: T0 })
  const done = (name: string, fields: Partial<ActionsJob> = {}) => jobOf(name, { startedAt: T0, completedAt: T0 + 18 * SECOND, ...fields })
  const cardAt = (jobs: ActionsJob[], watched: Record<string, number | null> = { 482: null }, now = SOON) =>
    buildSnapshot(inputs({ data: dataOf({ runs: [lagging], jobs: { 482: jobs }, watched }), now })).cards[0]

  test('all jobs done: drawn complete, its duration frozen at the last job', () => {
    const card = cardAt([done('lint'), done('test', { completedAt: T0 + 18 * SECOND })])
    expect(card).toMatchObject({ status: 'success', isActive: false, durationMs: 18 * SECOND })
  })

  test('the frozen duration does not tick with the clock', () => {
    const jobs = [done('lint', { completedAt: T0 + 9 * SECOND }), done('test')]
    expect(cardAt(jobs, { 482: null }, SOON)?.durationMs).toBe(18 * SECOND)
    expect(cardAt(jobs, { 482: null }, SOON + 5 * SECOND)?.durationMs).toBe(18 * SECOND)
  })

  test('the conclusion comes from the jobs: failure beats cancelled beats success', () => {
    expect(cardAt([done('a'), done('b', { conclusion: 'failure' }), done('c', { conclusion: 'cancelled' })])?.status).toBe('failure')
    expect(cardAt([done('a'), done('b', { conclusion: 'timed_out' })])?.status).toBe('failure')
    expect(cardAt([done('a'), done('b', { conclusion: 'cancelled' })])?.status).toBe('cancelled')
    expect(cardAt([done('a'), done('b', { conclusion: 'skipped' })])?.status).toBe('success')
  })

  test('a job still running keeps the run running', () => {
    const running = jobOf('test', { status: 'in_progress', conclusion: null, completedAt: null })
    expect(cardAt([done('lint'), running])).toMatchObject({ status: 'running', isActive: true })
  })

  test('no jobs read yet: the run stays as GitHub says', () => {
    expect(cardAt([])).toMatchObject({ status: 'running', isActive: true })
  })

  test('it counts as finished: no active ids, counted as passed', () => {
    const snapshot = buildSnapshot(inputs({ data: dataOf({ runs: [lagging], jobs: { 482: [done('lint')] }, watched: { 482: null } }), now: SOON }))
    expect(snapshot.activeIds).toEqual([])
    expect(snapshot.polledIds).toEqual([482])
    expect(snapshot.counts).toEqual({ running: 0, failed: 0, passed: 1 })
  })

  test('its linger starts at the last job, not when GitHub catches up', () => {
    const jobs = [done('lint')]
    const lingerEnd = T0 + 18 * SECOND + DEFAULT_SETTINGS.lingerMs
    expect(cardAt(jobs, { 482: null }, lingerEnd - 1)).toBeDefined()
    expect(cardAt(jobs, { 482: null }, lingerEnd)).toBeUndefined()
  })

  test('GitHub completing late does not bring a lingered-out run back', () => {
    const run = { ...lagging, status: 'completed', conclusion: 'success', updatedAt: T0 + 18 * SECOND }
    const lingerEnd = T0 + 18 * SECOND + DEFAULT_SETTINGS.lingerMs
    const data = dataOf({ runs: [run], jobs: { 482: [done('lint')] }, watched: { 482: lingerEnd + 5 * SECOND } })
    expect(buildSnapshot(inputs({ data, now: lingerEnd + 6 * SECOND })).cards).toEqual([])
  })
})
