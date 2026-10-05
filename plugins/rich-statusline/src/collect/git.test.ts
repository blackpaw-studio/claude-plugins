import { describe, expect, test } from 'claude-code/testing'
import { collectGit, parseShortstat, parseWorktree } from './git'
import type { RunInit, RunResult } from './run'

const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: '' })
const exit = (exitCode: number, stderr = ''): RunResult => ({ exitCode, stdout: '', stderr })

type Script = Record<string, RunResult | Error>

/** A runner answering by argv; records argv, cwd and env of every call. */
const scripted = (script: Script) => {
  const calls: { argv: string; cwd?: string; env?: Record<string, string> }[] = []
  const run = async (argv: readonly string[], init?: RunInit): Promise<RunResult> => {
    const key = argv.join(' ')
    calls.push({ argv: key, ...(init?.cwd === undefined ? {} : { cwd: init.cwd }), ...(init?.env === undefined ? {} : { env: init.env }) })
    const answer = script[key]
    if (answer === undefined) throw new Error(`unscripted: ${key}`)
    if (answer instanceof Error) throw answer
    return answer
  }
  return { run, calls }
}

const TOPLEVEL = 'git rev-parse --show-toplevel'
const ABBREV = 'git rev-parse --abbrev-ref HEAD'
const SYMBOLIC = 'git symbolic-ref --short HEAD'
const SHORT = 'git rev-parse --short HEAD'
const DIFF = 'git diff HEAD --shortstat'
const DIRS = 'git rev-parse --path-format=absolute --git-dir --git-common-dir'
const MAIN_TREE = ok('/repo/.git\n/repo/.git\n')

describe('parseShortstat', () => {
  test('insertions and deletions', () => {
    expect(parseShortstat(' 3 files changed, 12 insertions(+), 3 deletions(-)\n')).toEqual({ insertions: 12, deletions: 3 })
  })
  test('insertions only', () => {
    expect(parseShortstat(' 1 file changed, 1 insertion(+)\n')).toEqual({ insertions: 1, deletions: 0 })
  })
  test('deletions only', () => {
    expect(parseShortstat(' 2 files changed, 7 deletions(-)\n')).toEqual({ insertions: 0, deletions: 7 })
  })
  test('empty output is a clean tree: zero both ways', () => {
    expect(parseShortstat('')).toEqual({ insertions: 0, deletions: 0 })
    expect(parseShortstat('\n')).toEqual({ insertions: 0, deletions: 0 })
  })
})

describe('parseWorktree', () => {
  test('the main working tree: git dir and common dir agree', () => {
    expect(parseWorktree('/repo/.git\n/repo/.git\n', '/repo')).toBeNull()
    expect(parseWorktree('/repo/.git/\n/repo/.git\n', '/repo')).toBeNull()
  })
  test('a linked worktree is named after its top-level folder', () => {
    expect(parseWorktree('/repo/.git/worktrees/feat-x\n/repo/.git\n', '/work/feat-x')).toBe('feat-x')
    expect(parseWorktree('/repo/.git/worktrees/x\n/repo/.git\n', '/work/feat-x/')).toBe('feat-x')
  })
  test('an older git echoing the unknown flag first still reads the last two lines', () => {
    expect(parseWorktree('--path-format=absolute\n.git\n.git\n', '/repo')).toBeNull()
  })
  test('anything short of two directories is no worktree', () => {
    expect(parseWorktree('', '/repo')).toBeNull()
    expect(parseWorktree('/repo/.git\n', '/repo')).toBeNull()
  })
})

describe('collectGit', () => {
  test('reads root, branch and diff in the cwd, git told to take no optional locks', async () => {
    const { run, calls } = scripted({
      [TOPLEVEL]: ok('/repo\n'),
      [DIRS]: MAIN_TREE,
      [ABBREV]: ok('feat/x\n'),
      [DIFF]: ok(' 1 file changed, 4 insertions(+), 2 deletions(-)\n'),
    })
    expect(await collectGit(run, '/repo/src')).toEqual({
      root: '/repo',
      worktree: null,
      branch: 'feat/x',
      diff: { insertions: 4, deletions: 2 },
    })
    expect(calls.map(c => c.argv)).toEqual([TOPLEVEL, DIRS, ABBREV, DIFF])
    expect(calls.every(c => c.cwd === '/repo/src' && c.env?.GIT_OPTIONAL_LOCKS === '0')).toBe(true)
  })
  test('a real non-zero exit outside a repository reads as no git', async () => {
    const { run } = scripted({ [TOPLEVEL]: exit(128, 'fatal: not a git repository') })
    expect(await collectGit(run, '/tmp')).toEqual({ root: null, worktree: null, branch: null, diff: null })
  })
  test('a run that rejects (timeout, cannot start) keeps the cache', async () => {
    const { run } = scripted({ [TOPLEVEL]: new Error('timed out') })
    expect(await collectGit(run, '/repo')).toBeUndefined()
  })
  test('a non-zero exit with nothing on stderr (killed by a signal) keeps the cache', async () => {
    const { run } = scripted({ [TOPLEVEL]: exit(137) })
    expect(await collectGit(run, '/repo')).toBeUndefined()
  })
  test('a lock error keeps the cache', async () => {
    const { run } = scripted({
      [TOPLEVEL]: ok('/repo\n'),
      [DIRS]: MAIN_TREE,
      [ABBREV]: ok('main\n'),
      [DIFF]: exit(128, "fatal: Unable to create '/repo/.git/index.lock': File exists."),
    })
    expect(await collectGit(run, '/repo')).toBeUndefined()
  })
  test('an unborn repository shows its branch from symbolic-ref', async () => {
    const { run } = scripted({
      [TOPLEVEL]: ok('/fresh\n'),
      [DIRS]: MAIN_TREE,
      [ABBREV]: exit(128, "fatal: ambiguous argument 'HEAD': unknown revision"),
      [SYMBOLIC]: ok('main\n'),
      [DIFF]: exit(128, "fatal: bad revision 'HEAD'"),
    })
    expect(await collectGit(run, '/fresh')).toEqual({ root: '/fresh', worktree: null, branch: 'main', diff: null })
  })
  test('a detached HEAD shows the short sha', async () => {
    const { run } = scripted({
      [TOPLEVEL]: ok('/repo\n'),
      [DIRS]: MAIN_TREE,
      [ABBREV]: ok('HEAD\n'),
      [SHORT]: ok('a1b2c3d\n'),
      [DIFF]: ok(''),
    })
    expect(await collectGit(run, '/repo')).toEqual({
      root: '/repo',
      worktree: null,
      branch: 'a1b2c3d',
      diff: { insertions: 0, deletions: 0 },
    })
  })
  test('a linked worktree carries its name', async () => {
    const { run } = scripted({
      [TOPLEVEL]: ok('/work/feat-x\n'),
      [DIRS]: ok('/repo/.git/worktrees/feat-x\n/repo/.git\n'),
      [ABBREV]: ok('feat/x\n'),
      [DIFF]: ok(' 1 file changed, 1 insertion(+)\n'),
    })
    expect(await collectGit(run, '/work/feat-x')).toEqual({
      root: '/work/feat-x',
      worktree: 'feat-x',
      branch: 'feat/x',
      diff: { insertions: 1, deletions: 0 },
    })
  })
  test('a worktree read that fails without a reason keeps the cache', async () => {
    const timedOut = scripted({ [TOPLEVEL]: ok('/repo\n'), [DIRS]: new Error('timed out') })
    expect(await collectGit(timedOut.run, '/repo')).toBeUndefined()
    const locked = scripted({ [TOPLEVEL]: ok('/repo\n'), [DIRS]: exit(128, "fatal: '/repo/.git/index.lock' exists") })
    expect(await collectGit(locked.run, '/repo')).toBeUndefined()
  })
  test('a worktree read git refuses with a reason shows no worktree', async () => {
    const { run } = scripted({
      [TOPLEVEL]: ok('/repo\n'),
      [DIRS]: exit(128, 'fatal: unknown option'),
      [ABBREV]: ok('main\n'),
      [DIFF]: ok(''),
    })
    expect((await collectGit(run, '/repo'))?.worktree).toBeNull()
  })
})
