import { describe, expect, test } from 'claude-code/testing'
import { fail as failWith, ok, runner } from '../testing/runner'
import { collectHead } from './git'

const fail = (stderr: string) => failWith(stderr, 128)

const SHA = '808f9bc6a6179a008b1cf60261e6ef6fa58cd1ae'

const HEAD = 'git rev-parse HEAD --abbrev-ref HEAD'

describe('collectHead', () => {
  test('reads the sha and branch in one call, read-only, in the cwd', async () => {
    const { run, asked } = runner({ [HEAD]: ok(`${SHA}\nfeat/actions-pane\n`) })
    expect(await collectHead(run, '/repo')).toEqual({ kind: 'ok', sha: SHA, branch: 'feat/actions-pane' })
    expect(asked[0]?.init).toEqual({ cwd: '/repo', timeoutMs: 10_000, env: { GIT_OPTIONAL_LOCKS: '0' } })
  })

  test('a detached HEAD has no branch', async () => {
    const { run } = runner({ [HEAD]: ok(`${SHA}\nHEAD\n`) })
    expect(await collectHead(run, '/repo')).toEqual({ kind: 'ok', sha: SHA, branch: null })
  })

  test('outside a repository is a fatal reason', async () => {
    const { run } = runner({ [HEAD]: fail('fatal: not a git repository (or any of the parent directories): .git') })
    expect(await collectHead(run, '/tmp')).toEqual({ kind: 'fatal', reason: 'not a git repository' })
  })

  test('an unborn branch has its name and no sha', async () => {
    const { run } = runner({
      [HEAD]: fail("fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree."),
      'git symbolic-ref --short HEAD': ok('main\n'),
    })
    expect(await collectHead(run, '/new')).toEqual({ kind: 'ok', sha: null, branch: 'main' })
  })

  test('git that cannot start, or a lock, is transient', async () => {
    expect(await collectHead(runner({ [HEAD]: new Error('spawn git ENOENT') }).run, '/r')).toEqual({
      kind: 'transient',
      reason: 'spawn git ENOENT',
    })
    const locked = runner({ [HEAD]: fail("fatal: Unable to create '/r/.git/index.lock': File exists.") })
    expect((await collectHead(locked.run, '/r')).kind).toBe('transient')
  })
})
