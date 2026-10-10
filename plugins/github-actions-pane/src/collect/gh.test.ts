import { describe, expect, test } from 'claude-code/testing'
import { JOBS_IN_PROGRESS, JOBS_LINT_FAILED, JOBS_NONE, RUN_LIST } from '../testing/gh-fixtures'
import { ghRun, MINUTE, runOf, T0 } from '../testing/builders'
import { fail, ok, runner } from '../testing/runner'
import { classifyFailure, listRuns, parseJobs, parseRuns, repoName, viewJobs, RUN_FIELDS } from './gh'

const at = (iso: string) => Date.parse(iso)
const GH_INIT = { cwd: '/repo', timeoutMs: 10_000, env: { GH_PROMPT_DISABLED: '1' } }
const LIST = `gh run list --limit 20 --json ${RUN_FIELDS}`

describe('parseRuns', () => {
  test('reads gh run list JSON, a run not yet concluded with a null conclusion', () => {
    const runs = parseRuns(RUN_LIST)
    expect(runs?.length).toBe(6)
    expect(runs?.[0]).toEqual({
      id: 38015447143,
      number: 1637,
      workflow: 'Dependabot PR Triage (skills-driven)',
      title: 'Dependabot PR Triage (skills-driven)',
      event: 'schedule',
      status: 'queued',
      conclusion: null,
      branch: 'trunk',
      sha: 'ec5b512045db67e5a2a4ff4a1b02660b2fb24390',
      createdAt: at('2026-10-10T02:02:00Z'),
      startedAt: at('2026-10-10T02:02:00Z'),
      updatedAt: at('2026-10-10T02:03:35Z'),
      url: 'https://github.com/cli/cli/actions/runs/38015447143',
    })
    expect(runs?.[5]?.title).toBe(
      '`--attach` cannot work for GitHub App installation tokens — the upload endpoint 404s them even with write access',
    )
  })

  test('drops malformed entries; output that is not a list is null', () => {
    const one = JSON.stringify([{ databaseId: 'x' }, ...JSON.parse(RUN_LIST).slice(0, 1)])
    expect(parseRuns(one)?.map(run => run.id)).toEqual([38015447143])
    expect(parseRuns('{"message":"Not Found"}')).toBe(null)
    expect(parseRuns('not json')).toBe(null)
  })
})

describe('parseJobs', () => {
  test('reads jobs and steps; the zero time and an empty conclusion read as null', () => {
    const jobs = parseJobs(JOBS_IN_PROGRESS)
    expect(jobs?.map(job => [job.name, job.status, job.conclusion])).toEqual([
      ['activation', 'completed', 'success'],
      ['agent', 'completed', 'success'],
      ['detection', 'in_progress', null],
    ])
    const detection = jobs?.[2]
    expect(detection?.completedAt).toBe(null)
    expect(detection?.startedAt).toBe(at('2026-10-10T02:03:38Z'))
    expect(detection?.steps.find(step => step.status === 'in_progress')).toEqual({
      name: 'Install GitHub Copilot CLI',
      number: 15,
      status: 'in_progress',
      conclusion: null,
      startedAt: at('2026-10-10T02:03:58Z'),
      completedAt: null,
    })
    expect(detection?.steps.filter(step => step.status === 'pending').every(step => step.startedAt === null)).toBe(true)
  })

  test('keeps the failed step of a failed job', () => {
    const jobs = parseJobs(JOBS_LINT_FAILED)
    const failed = jobs?.find(job => job.conclusion === 'failure')
    expect(failed?.name).toBe('govulncheck')
    expect(failed?.steps.filter(step => step.conclusion === 'failure').map(step => step.name)).toEqual(['Check Go vulnerabilities'])
    expect(failed?.url).toBe('https://github.com/cli/cli/actions/runs/37981739982/job/113993700082')
  })

  test('a run that failed before any job: no jobs; bad output: null', () => {
    expect(parseJobs(JOBS_NONE)).toEqual([])
    expect(parseJobs('[]')).toBe(null)
  })
})

describe('listRuns', () => {
  test('repo scope lists without a filter, prompts off, bounded', async () => {
    const { run, asked } = runner({ [LIST]: ok(RUN_LIST) })
    const listed = await listRuns(run, '/repo', { kind: 'repo' })
    expect(listed.kind === 'ok' ? listed.value.length : listed).toBe(6)
    expect(asked).toEqual([{ argv: LIST, init: GH_INIT }])
  })

  test('branch and commit scopes filter on the server', async () => {
    const { run, asked } = runner({ [`${LIST} --branch main`]: ok('[]'), [`${LIST} --commit abc123`]: ok('[]') })
    await listRuns(run, '/repo', { kind: 'branch', branch: 'main' })
    await listRuns(run, '/repo', { kind: 'commit', sha: 'abc123' })
    expect(asked.map(call => call.argv)).toEqual([`${LIST} --branch main`, `${LIST} --commit abc123`])
  })

  // A full page can hide an older run still going: ask for the active ones too.
  const finished = Array.from({ length: 20 }, (_, i) =>
    runOf({ id: 1000 + i, status: 'completed', conclusion: 'success', createdAt: T0 - i * MINUTE }))
  const older = runOf({ id: 7, createdAt: T0 - 60 * MINUTE })
  const pageOf = (runs: typeof finished) => ok(JSON.stringify(runs.map(ghRun)))
  const BRANCH = `${LIST} --branch main`

  test('a full page also lists the in-progress and queued runs, merged without repeats', async () => {
    const { run, asked } = runner({
      [BRANCH]: pageOf(finished),
      [`${BRANCH} --status in_progress`]: pageOf([older]),
      [`${BRANCH} --status queued`]: pageOf([older]),
    })
    const listed = await listRuns(run, '/repo', { kind: 'branch', branch: 'main' })
    expect(listed.kind === 'ok' ? listed.value.map(one => one.id) : listed).toEqual([...finished.map(one => one.id), 7])
    expect(asked.map(call => call.argv)).toEqual([BRANCH, `${BRANCH} --status in_progress`, `${BRANCH} --status queued`])
  })

  test('a page short of the limit is the whole list: one call', async () => {
    const { run, asked } = runner({ [BRANCH]: pageOf(finished.slice(1)) })
    await listRuns(run, '/repo', { kind: 'branch', branch: 'main' })
    expect(asked).toHaveLength(1)
  })

  test('a failed active query fails the list rather than drop a running run', async () => {
    const { run } = runner({
      [BRANCH]: pageOf(finished),
      [`${BRANCH} --status in_progress`]: fail('HTTP 403: API rate limit exceeded'),
      [`${BRANCH} --status queued`]: pageOf([]),
    })
    expect((await listRuns(run, '/repo', { kind: 'branch', branch: 'main' })).kind).toBe('rate-limited')
  })

  test('output that does not parse is transient', async () => {
    const { run } = runner({ [LIST]: ok('<html>') })
    expect(await listRuns(run, '/repo', { kind: 'repo' })).toEqual({ kind: 'transient', reason: 'gh returned output that is not a run list' })
  })
})

describe('viewJobs and repoName', () => {
  test('viewJobs asks for one run', async () => {
    const { run, asked } = runner({ 'gh run view 37981739982 --json jobs': ok(JOBS_LINT_FAILED) })
    const viewed = await viewJobs(run, '/repo', 37981739982)
    expect(viewed.kind === 'ok' ? viewed.value.map(job => job.name) : viewed).toEqual(['lint', 'govulncheck'])
    expect(asked[0]?.init).toEqual(GH_INIT)
  })

  test('repoName reads owner/repo', async () => {
    const { run } = runner({ 'gh repo view --json nameWithOwner': ok('{"nameWithOwner":"blackpaw-studio/claude-plugins"}\n') })
    expect(await repoName(run, '/repo')).toEqual({ kind: 'ok', value: 'blackpaw-studio/claude-plugins' })
  })
})

describe('classifyFailure', () => {
  const ran = (stderr: string, exitCode = 1) => ({ kind: 'ran' as const, result: fail(stderr, exitCode) })

  test('rate limits, primary and secondary, by status or words', () => {
    expect(classifyFailure(ran('HTTP 403: API rate limit exceeded for user ID 1234.'))).toEqual({ kind: 'rate-limited' })
    expect(classifyFailure(ran('HTTP 429: Too Many Requests'))).toEqual({ kind: 'rate-limited' })
    expect(classifyFailure(ran('HTTP 403: You have exceeded a secondary rate limit.'))).toEqual({ kind: 'rate-limited' })
  })

  test('missing gh, no login, no GitHub remote are fatal with a reason to show', () => {
    expect(classifyFailure({ kind: 'failed', message: 'spawn gh ENOENT' })).toEqual({ kind: 'fatal', reason: 'gh is not installed' })
    expect(classifyFailure(ran('To get started with GitHub CLI, please run:  gh auth login', 4))).toEqual({
      kind: 'fatal',
      reason: 'gh is not logged in (run gh auth login)',
    })
    expect(classifyFailure(ran('failed to determine base repo: no git remotes found'))).toEqual({
      kind: 'fatal',
      reason: 'no GitHub remote',
    })
    expect(
      classifyFailure(ran('none of the git remotes configured for this repository point to a known GitHub host.')),
    ).toEqual({ kind: 'fatal', reason: 'no GitHub remote' })
  })

  test('anything else is transient, with its first line', () => {
    expect(classifyFailure({ kind: 'failed', message: 'timed out after 10000ms' })).toEqual({
      kind: 'transient',
      reason: 'timed out after 10000ms',
    })
    expect(classifyFailure(ran('error connecting to api.github.com\ncheck your internet connection'))).toEqual({
      kind: 'transient',
      reason: 'error connecting to api.github.com',
    })
  })
})
