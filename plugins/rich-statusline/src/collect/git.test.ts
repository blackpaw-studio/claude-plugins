import { describe, expect, test } from 'claude-code/testing'
import { collectGit, parseShortstat } from './git'
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
  test('empty output is a clean tree', () => {
    expect(parseShortstat('')).toBeNull()
    expect(parseShortstat('\n')).toBeNull()
  })
})

describe('collectGit', () => {
  test('reads root, branch and diff in the cwd, git told to take no optional locks', async () => {
    const { run, calls } = scripted({
      [TOPLEVEL]: ok('/repo\n'),
      [ABBREV]: ok('feat/x\n'),
      [DIFF]: ok(' 1 file changed, 4 insertions(+), 2 deletions(-)\n'),
    })
    expect(await collectGit(run, '/repo/src')).toEqual({ root: '/repo', branch: 'feat/x', diff: { insertions: 4, deletions: 2 } })
    expect(calls.map(c => c.argv)).toEqual([TOPLEVEL, ABBREV, DIFF])
    expect(calls.every(c => c.cwd === '/repo/src' && c.env?.GIT_OPTIONAL_LOCKS === '0')).toBe(true)
  })
  test('a real non-zero exit outside a repository reads as no git', async () => {
    const { run } = scripted({ [TOPLEVEL]: exit(128, 'fatal: not a git repository') })
    expect(await collectGit(run, '/tmp')).toEqual({ root: null, branch: null, diff: null })
  })
  test('a run that rejects (timeout, cannot start) keeps the cache', async () => {
    const { run } = scripted({ [TOPLEVEL]: new Error('timed out') })
    expect(await collectGit(run, '/repo')).toBeUndefined()
  })
  test('a lock error keeps the cache', async () => {
    const { run } = scripted({
      [TOPLEVEL]: ok('/repo\n'),
      [ABBREV]: ok('main\n'),
      [DIFF]: exit(128, "fatal: Unable to create '/repo/.git/index.lock': File exists."),
    })
    expect(await collectGit(run, '/repo')).toBeUndefined()
  })
  test('an unborn repository shows its branch from symbolic-ref', async () => {
    const { run } = scripted({
      [TOPLEVEL]: ok('/fresh\n'),
      [ABBREV]: exit(128, "fatal: ambiguous argument 'HEAD': unknown revision"),
      [SYMBOLIC]: ok('main\n'),
      [DIFF]: exit(128, "fatal: bad revision 'HEAD'"),
    })
    expect(await collectGit(run, '/fresh')).toEqual({ root: '/fresh', branch: 'main', diff: null })
  })
  test('a detached HEAD shows the short sha', async () => {
    const { run } = scripted({
      [TOPLEVEL]: ok('/repo\n'),
      [ABBREV]: ok('HEAD\n'),
      [SHORT]: ok('a1b2c3d\n'),
      [DIFF]: ok(''),
    })
    expect(await collectGit(run, '/repo')).toEqual({ root: '/repo', branch: 'a1b2c3d', diff: null })
  })
})
