import { describe, expect, test } from 'claude-code/testing'
import { fail, ok, runner } from '../testing/runner'
import { readRef, trackingRefOf } from './remote-ref'

const SHA = '808f9bc6a6179a008b1cf60261e6ef6fa58cd1ae'
const PUSH = 'git rev-parse --symbolic-full-name @{push}'

describe('trackingRefOf', () => {
  test("the branch's push target, read-only, in the cwd", async () => {
    const { run, asked } = runner({ [PUSH]: ok('refs/remotes/fork/feat/actions-pane\n') })
    expect(await trackingRefOf(run, '/repo', 'feat/actions-pane')).toBe('refs/remotes/fork/feat/actions-pane')
    expect(asked[0]?.init).toEqual({ cwd: '/repo', timeoutMs: 10_000, env: { GIT_OPTIONAL_LOCKS: '0' } })
  })

  test('a branch with no push target (never pushed with -u) tracks origin', async () => {
    const { run } = runner({ [PUSH]: fail('fatal: The current branch feat/x has no upstream branch.', 128) })
    expect(await trackingRefOf(run, '/repo', 'feat/x')).toBe('refs/remotes/origin/feat/x')
  })

  test('git that cannot start also falls back to origin', async () => {
    const { run } = runner({ [PUSH]: new Error('spawn git ENOENT') })
    expect(await trackingRefOf(run, '/repo', 'main')).toBe('refs/remotes/origin/main')
  })
})

describe('readRef', () => {
  const VERIFY = 'git rev-parse --verify -q refs/remotes/origin/main'

  test('the sha the ref holds', async () => {
    const { run } = runner({ [VERIFY]: ok(`${SHA}\n`) })
    expect(await readRef(run, '/repo', 'refs/remotes/origin/main')).toEqual({ kind: 'ok', sha: SHA })
  })

  test('a ref that does not exist yet holds no sha', async () => {
    const { run } = runner({ [VERIFY]: fail('', 1) })
    expect(await readRef(run, '/repo', 'refs/remotes/origin/main')).toEqual({ kind: 'ok', sha: null })
  })

  test('a git that errors or cannot start is unknown, not a change', async () => {
    expect((await readRef(runner({ [VERIFY]: fail('fatal: bad object', 128) }).run, '/repo', 'refs/remotes/origin/main')).kind).toBe('unknown')
    expect((await readRef(runner({ [VERIFY]: new Error('timed out') }).run, '/repo', 'refs/remotes/origin/main')).kind).toBe('unknown')
  })
})
