import { describe, expect, test } from 'claude-code/testing'
import { collectGit, parseBranch, parseShortstat } from './git'

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })

describe('parseShortstat', () => {
  test('insertions and deletions', () => {
    expect(parseShortstat(' 3 files changed, 12 insertions(+), 3 deletions(-)\n')).toEqual({
      insertions: 12,
      deletions: 3,
    })
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

describe('parseBranch', () => {
  test('a branch name', () => {
    expect(parseBranch(ok('main\n'))).toBe('main')
  })
  test('not a repository', () => {
    expect(parseBranch({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' })).toBeNull()
    expect(parseBranch(ok(''))).toBeNull()
  })
})

describe('collectGit', () => {
  test('reads branch and diff in the cwd', async () => {
    const calls: string[] = []
    const run = async (argv: readonly string[], init?: { cwd?: string }) => {
      calls.push(`${argv.join(' ')} @ ${init?.cwd ?? ''}`)
      return argv.includes('rev-parse') ? ok('feat/x\n') : ok(' 1 file changed, 4 insertions(+), 2 deletions(-)\n')
    }
    expect(await collectGit(run, '/repo')).toEqual({ branch: 'feat/x', diff: { insertions: 4, deletions: 2 } })
    expect(calls).toEqual([
      'git rev-parse --abbrev-ref HEAD @ /repo',
      'git diff HEAD --shortstat @ /repo',
    ])
  })
  test('outside a repository there is no diff', async () => {
    const run = async () => ({ exitCode: 128, stdout: '', stderr: 'fatal' })
    expect(await collectGit(run, '/tmp')).toEqual({ branch: null, diff: null })
  })
  test('a run that cannot start reads as no git', async () => {
    const run = async (): Promise<never> => {
      throw new Error('git: not found')
    }
    expect(await collectGit(run, '/tmp')).toEqual({ branch: null, diff: null })
  })
})
