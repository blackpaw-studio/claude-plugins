// Workflow runs and their jobs through gh: the user's own auth, the repo
// resolved from the git remote, JSON out. Parsing is pure and validates
// every field, since gh's output is external input.
import type { ActionsJob, ActionsRun, ActionsStep } from '../../types'
import { type Ran, type Run, type RunInit, tryRun } from './run'

const GH_TIMEOUT_MS = 10_000
const GH_ENV = { GH_PROMPT_DISABLED: '1' }
const LIST_LIMIT = 20

export const RUN_FIELDS =
  'databaseId,number,workflowName,displayTitle,event,status,conclusion,headBranch,headSha,createdAt,startedAt,updatedAt,url'

/** One `gh run list` filter; gh cannot OR `--branch` with `--commit`. */
export type LeafFilter = { kind: 'repo' } | { kind: 'branch'; branch: string } | { kind: 'commit'; sha: string }

/** A leaf, or the union of several: a run matching any part belongs. */
export type ListFilter = LeafFilter | { kind: 'any'; of: readonly LeafFilter[] }

export type GhFailure =
  | { kind: 'rate-limited' }
  | { kind: 'fatal'; reason: string }
  | { kind: 'transient'; reason: string }

export type GhResult<T> = { kind: 'ok'; value: T } | GhFailure

type Fields = Record<string, unknown>

const RATE_LIMIT = /rate limit|HTTP 429/i
const NOT_LOGGED_IN = /gh auth login|not logged in/i
const NO_REMOTE = /no git remotes|none of the git remotes|could not determine (base|current) repo|not a git repository/i
const NOT_INSTALLED = /ENOENT|not found|no such file/i
const AUTH_EXIT = 4

const firstLine = (text: string): string => text.trim().split('\n')[0]?.trim() ?? ''

/** Why a gh call failed, sorted by what the poller does next. Pure. */
export const classifyFailure = (ran: Ran): GhFailure => {
  if (ran.kind === 'failed') {
    return NOT_INSTALLED.test(ran.message) ? { kind: 'fatal', reason: 'gh is not installed' } : { kind: 'transient', reason: ran.message }
  }
  const { exitCode, stderr } = ran.result
  if (RATE_LIMIT.test(stderr)) return { kind: 'rate-limited' }
  if (exitCode === AUTH_EXIT || NOT_LOGGED_IN.test(stderr)) return { kind: 'fatal', reason: 'gh is not logged in (run gh auth login)' }
  if (NO_REMOTE.test(stderr)) return { kind: 'fatal', reason: 'no GitHub remote' }
  return { kind: 'transient', reason: firstLine(stderr) || `gh exited ${exitCode}` }
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const stringOf = (fields: Fields, key: string): string | null => (typeof fields[key] === 'string' ? (fields[key] as string) : null)
const integerOf = (fields: Fields, key: string): number | null => {
  const value = fields[key]
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/** An ISO time to epoch ms; GitHub's zero time (`0001-01-01…`) and junk read as null. */
const timeOf = (fields: Fields, key: string): number | null => {
  const text = stringOf(fields, key)
  const ms = text === null ? Number.NaN : Date.parse(text)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

/** `""` (not concluded yet) reads as null. */
const conclusionOf = (fields: Fields): string | null => {
  const text = stringOf(fields, 'conclusion')
  return text === null || text === '' ? null : text
}

const toRun = (value: unknown): ActionsRun | null => {
  if (!isFields(value)) return null
  const id = integerOf(value, 'databaseId')
  const number = integerOf(value, 'number')
  const status = stringOf(value, 'status')
  const createdAt = timeOf(value, 'createdAt')
  const url = stringOf(value, 'url')
  if (id === null || number === null || status === null || createdAt === null || url === null) return null
  return {
    id,
    number,
    workflow: stringOf(value, 'workflowName') ?? 'workflow',
    title: stringOf(value, 'displayTitle') ?? '',
    event: stringOf(value, 'event') ?? '',
    status,
    conclusion: conclusionOf(value),
    branch: stringOf(value, 'headBranch') ?? '',
    sha: stringOf(value, 'headSha') ?? '',
    createdAt,
    startedAt: timeOf(value, 'startedAt'),
    updatedAt: timeOf(value, 'updatedAt') ?? createdAt,
    url,
  }
}

const toStep = (value: unknown): ActionsStep | null => {
  if (!isFields(value)) return null
  const name = stringOf(value, 'name')
  const number = integerOf(value, 'number')
  const status = stringOf(value, 'status')
  if (name === null || number === null || status === null) return null
  return {
    name,
    number,
    status,
    conclusion: conclusionOf(value),
    startedAt: timeOf(value, 'startedAt'),
    completedAt: timeOf(value, 'completedAt'),
  }
}

const isPresent = <T>(value: T | null): value is T => value !== null

const toJob = (value: unknown): ActionsJob | null => {
  if (!isFields(value)) return null
  const id = integerOf(value, 'databaseId')
  const name = stringOf(value, 'name')
  const status = stringOf(value, 'status')
  if (id === null || name === null || status === null) return null
  const steps = Array.isArray(value.steps) ? value.steps.map(toStep).filter(isPresent) : []
  return {
    id,
    name,
    status,
    conclusion: conclusionOf(value),
    startedAt: timeOf(value, 'startedAt'),
    completedAt: timeOf(value, 'completedAt'),
    url: stringOf(value, 'url') ?? '',
    steps: [...steps].sort((a, b) => a.number - b.number),
  }
}

/** `gh run list --json …` output to runs, malformed entries dropped; null when it is no list. Pure. */
export const parseRuns = (stdout: string): ActionsRun[] | null => {
  const parsed = parseJson(stdout)
  return Array.isArray(parsed) ? parsed.map(toRun).filter(isPresent) : null
}

/** `gh run view --json jobs` output to jobs; null when it has no jobs list. Pure. */
export const parseJobs = (stdout: string): ActionsJob[] | null => {
  const parsed = parseJson(stdout)
  return isFields(parsed) && Array.isArray(parsed.jobs) ? parsed.jobs.map(toJob).filter(isPresent) : null
}

const filterArgs = (filter: LeafFilter): string[] =>
  filter.kind === 'branch' ? ['--branch', filter.branch] : filter.kind === 'commit' ? ['--commit', filter.sha] : []

/** Runs gh in `cwd` and parses its stdout; any failure classified. */
const gh = async <T>(run: Run, cwd: string, args: readonly string[], parse: (stdout: string) => T | null, what: string): Promise<GhResult<T>> => {
  const init: RunInit = { cwd, timeoutMs: GH_TIMEOUT_MS, env: GH_ENV }
  const ran = await tryRun(run, ['gh', ...args], init)
  if (ran.kind === 'failed' || ran.result.exitCode !== 0) return classifyFailure(ran)
  const value = parse(ran.result.stdout)
  return value === null ? { kind: 'transient', reason: `gh returned output that is not ${what}` } : { kind: 'ok', value }
}

/** The statuses asked for apart when the newest page is full, so a long run can't fall off it. */
const ACTIVE_STATUSES = ['in_progress', 'queued'] as const

const listPage = (run: Run, cwd: string, filter: LeafFilter, extra: readonly string[] = []): Promise<GhResult<ActionsRun[]>> =>
  gh(run, cwd, ['run', 'list', '--limit', String(LIST_LIMIT), '--json', RUN_FIELDS, ...filterArgs(filter), ...extra], parseRuns, 'a run list')

/**
 * The newest runs in the filter, plus, when that page is full, the active runs
 * older than it (one more call per active status). Any failed call fails the list.
 */
const listLeaf = async (run: Run, cwd: string, filter: LeafFilter): Promise<GhResult<ActionsRun[]>> => {
  const newest = await listPage(run, cwd, filter)
  if (newest.kind !== 'ok' || newest.value.length < LIST_LIMIT) return newest
  const pages = await Promise.all(ACTIVE_STATUSES.map(status => listPage(run, cwd, filter, ['--status', status])))
  const failed = pages.find(page => page.kind !== 'ok')
  if (failed !== undefined) return failed
  const onPage = new Set(newest.value.map(one => one.id))
  const older = pages.flatMap(page => (page.kind === 'ok' ? page.value : [])).filter(one => !onPage.has(one.id))
  const unique = older.filter((one, index) => older.findIndex(other => other.id === one.id) === index)
  return { kind: 'ok', value: [...newest.value, ...unique] }
}

/** The runs of every part of the filter, merged without repeats (a failed part fails the list), newest first. */
export const listRuns = async (run: Run, cwd: string, filter: ListFilter): Promise<GhResult<ActionsRun[]>> => {
  if (filter.kind !== 'any') return listLeaf(run, cwd, filter)
  const lists = await Promise.all(filter.of.map(leaf => listLeaf(run, cwd, leaf)))
  const failed = lists.find(list => list.kind !== 'ok')
  if (failed !== undefined) return failed
  const all = lists.flatMap(list => (list.kind === 'ok' ? list.value : []))
  const unique = all.filter((one, index) => all.findIndex(other => other.id === one.id) === index)
  return { kind: 'ok', value: [...unique].sort((a, b) => b.createdAt - a.createdAt) }
}

export const viewJobs = (run: Run, cwd: string, id: number): Promise<GhResult<ActionsJob[]>> =>
  gh(run, cwd, ['run', 'view', String(id), '--json', 'jobs'], parseJobs, 'a job list')

const parseRepo = (stdout: string): string | null => {
  const parsed = parseJson(stdout)
  return isFields(parsed) ? stringOf(parsed, 'nameWithOwner') : null
}

/** `owner/repo` for the cwd's remote: also the check that gh is installed, logged in and pointed at GitHub. */
export const repoName = (run: Run, cwd: string): Promise<GhResult<string>> =>
  gh(run, cwd, ['repo', 'view', '--json', 'nameWithOwner'], parseRepo, 'a repository')
