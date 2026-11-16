import { describe, expect, test } from 'claude-code/testing'
import { fakeCacheFs } from '../testing/cache-fs'
import { fail, ok } from '../testing/runner'
import { fakeClock, flush } from '../testing/ports'
import { memoryBackoff } from './backoff-store'
import { cacheKey, decodeEntry, encodeEntry, encodeLock } from './cache-entry'
import type { Run, RunResult } from './run'
import { createSharedGh, directGh } from './shared-gh'

const T0 = 10_000_000
const DIR = '/cache/github-actions-pane'
const HOST = 'github.com'
const ARGV = ['gh', 'run', 'list', '--repo', 'acme/widgets']
const INIT = { cwd: '/r', timeoutMs: 10_000 }
const KEY = cacheKey(HOST, ARGV)
const ENTRY = `${DIR}/${KEY}.json`
const LOCK = `${DIR}/${KEY}.lock`
const POLL = { maxAgeMs: 10_000, kickAt: null }
const kickedAt = (kickAt: number) => ({ maxAgeMs: 10_000, kickAt })
const anything = () => true
const DAY = 24 * 60 * 60 * 1000

/** A run whose first call (or each, with `hangs`) waits for the test to release it. */
const setup = (answers: (call: number) => RunResult | Error | 'hang' = () => ok('[1]'), isAlive: (pid: number) => boolean = () => true) => {
  const clock = fakeClock(T0)
  const fs = fakeCacheFs(clock.now)
  const backoff = memoryBackoff()
  const calls: string[] = []
  const hung: ((result: RunResult) => void)[] = []
  const run: Run = async argv => {
    calls.push(argv.join(' '))
    const answer = answers(calls.length)
    if (answer === 'hang') return new Promise<RunResult>(resolve => void hung.push(resolve))
    if (answer instanceof Error) throw answer
    return answer
  }
  const gh = createSharedGh({
    run,
    fs,
    backoff,
    now: async () => clock.now(),
    sleep: ms => new Promise<void>(resolve => void clock.after(ms, resolve)),
    isAlive: async pid => isAlive(pid),
    pid: async () => 4242,
    host: async () => HOST,
    dir: async () => DIR,
    log: () => undefined,
  })
  return { clock, fs, backoff, calls, hung, gh }
}

const stdoutOf = (answer: Awaited<ReturnType<ReturnType<typeof setup>['gh']>>): string | null =>
  answer.kind === 'ran' ? answer.result.stdout : null

describe('directGh', () => {
  test('runs and returns what the runner says, a failure as failed', async () => {
    const gh = directGh(async () => ok('x'))
    expect(stdoutOf(await gh(ARGV, INIT, POLL, anything))).toBe('x')
    const broken = directGh(async () => Promise.reject(new Error('boom')))
    expect(await broken(ARGV, INIT, POLL, anything)).toEqual({ kind: 'failed', message: 'boom' })
  })
})

describe('createSharedGh', () => {
  test('a miss fetches, writes the entry and releases the lock', async () => {
    const { fs, gh, calls, clock } = setup()
    expect(stdoutOf(await gh(ARGV, INIT, POLL, anything))).toBe('[1]')
    expect(calls).toEqual([ARGV.join(' ')])
    expect(decodeEntry((await fs.read(ENTRY)) ?? '', HOST, ARGV)).toEqual({ host: HOST, argv: ARGV, at: clock.now(), stdout: '[1]' })
    expect(fs.has(LOCK)).toBe(false)
  })

  test('a fresh entry is returned with no gh call', async () => {
    const { fs, gh, calls, clock } = setup()
    fs.put(ENTRY, encodeEntry({ host: HOST, argv: ARGV, at: T0, stdout: '[cached]' }))
    await clock.advance(5_000)
    expect(stdoutOf(await gh(ARGV, INIT, POLL, anything))).toBe('[cached]')
    expect(calls).toEqual([])
  })

  test('a stale entry is fetched afresh', async () => {
    const { fs, gh, calls, clock } = setup()
    fs.put(ENTRY, encodeEntry({ host: HOST, argv: ARGV, at: T0, stdout: '[old]' }))
    await clock.advance(9_000)
    expect(stdoutOf(await gh(ARGV, INIT, POLL, anything))).toBe('[1]')
    expect(calls.length).toBe(1)
  })

  test('a kick takes an entry written at or after it, never one from before the push', async () => {
    const { fs, gh, calls, clock } = setup()
    fs.put(ENTRY, encodeEntry({ host: HOST, argv: ARGV, at: T0, stdout: '[old]' }))
    await clock.advance(2_000)
    // The entry is 2s old: young, but written before this kick.
    expect(stdoutOf(await gh(ARGV, INIT, kickedAt(clock.now()), anything))).toBe('[1]')
    expect(calls.length).toBe(1)
    // Another session's kick for the same push finds that fetch enough.
    expect(stdoutOf(await gh(ARGV, INIT, kickedAt(clock.now()), anything))).toBe('[1]')
    expect(calls.length).toBe(1)
    // A kick that came before the entry was written is satisfied by it.
    expect(stdoutOf(await gh(ARGV, INIT, kickedAt(T0 + 1_000), anything))).toBe('[1]')
    expect(calls.length).toBe(1)
  })

  test('a corrupt entry is a miss: live fetch, entry repaired', async () => {
    const { fs, gh, calls } = setup()
    fs.put(ENTRY, '{"v":1,"host":')
    expect(stdoutOf(await gh(ARGV, INIT, POLL, anything))).toBe('[1]')
    expect(calls.length).toBe(1)
    expect(decodeEntry((await fs.read(ENTRY)) ?? '', HOST, ARGV)?.stdout).toBe('[1]')
  })

  test('a loser returns the stale entry without calling gh while the winner fetches', async () => {
    const { fs, gh, calls, hung } = setup(call => (call === 1 ? 'hang' : ok('[2]')))
    fs.put(ENTRY, encodeEntry({ host: HOST, argv: ARGV, at: T0 - 60_000, stdout: '[old]' }))
    const winner = gh(ARGV, INIT, POLL, anything)
    await flush()
    expect(stdoutOf(await gh(ARGV, INIT, POLL, anything))).toBe('[old]')
    expect(calls.length).toBe(1)
    hung[0]?.(ok('[fresh]'))
    expect(stdoutOf(await winner)).toBe('[fresh]')
    expect(fs.has(LOCK)).toBe(false)
  })

  test('a loser with no entry gets the winner write while it waits', async () => {
    const { gh, calls, hung, clock } = setup(call => (call === 1 ? 'hang' : ok('[2]')))
    const winner = gh(ARGV, INIT, POLL, anything)
    await flush()
    const loser = gh(ARGV, INIT, POLL, anything)
    await flush()
    await clock.advance(1_500)
    hung[0]?.(ok('[fresh]'))
    await winner
    await clock.advance(250)
    expect(stdoutOf(await loser)).toBe('[fresh]')
    expect(calls.length).toBe(1)
  })

  test('a loser with no entry fetches itself after 2s', async () => {
    const { gh, calls, hung, clock } = setup(call => (call === 1 ? 'hang' : ok('[mine]')))
    void gh(ARGV, INIT, POLL, anything)
    await flush()
    const loser = gh(ARGV, INIT, POLL, anything)
    await flush()
    await clock.advance(1_750)
    expect(calls.length).toBe(1)
    await clock.advance(250)
    expect(stdoutOf(await loser)).toBe('[mine]')
    expect(calls.length).toBe(2)
    expect(hung.length).toBe(1)
  })

  test('a lock whose holder is dead is stolen', async () => {
    const { fs, gh, calls } = setup(() => ok('[1]'), pid => pid !== 999)
    fs.put(LOCK, encodeLock({ pid: 999, at: T0, token: 'gone' }))
    expect(stdoutOf(await gh(ARGV, INIT, POLL, anything))).toBe('[1]')
    expect(calls.length).toBe(1)
    expect(fs.has(LOCK)).toBe(false)
  })

  test('a lock older than 30s is stolen', async () => {
    const { fs, gh, calls, clock } = setup()
    fs.put(LOCK, encodeLock({ pid: 777, at: T0, token: 'old' }))
    await clock.advance(31_000)
    expect(stdoutOf(await gh(ARGV, INIT, POLL, anything))).toBe('[1]')
    expect(calls.length).toBe(1)
  })

  test('an unreadable lock is stolen', async () => {
    const { fs, gh, calls } = setup()
    fs.put(LOCK, 'garbage')
    await gh(ARGV, INIT, POLL, anything)
    expect(calls.length).toBe(1)
  })

  test('a lock that cannot be made falls back to fetching without it', async () => {
    const { fs, gh, calls } = setup()
    fs.failNextCreate()
    expect(stdoutOf(await gh(ARGV, INIT, POLL, anything))).toBe('[1]')
    expect(calls.length).toBe(1)
    expect(fs.has(LOCK)).toBe(false)
  })

  test('the winner leaves a lock alone that someone else took over meanwhile', async () => {
    const { fs, gh, hung } = setup(() => 'hang')
    const winner = gh(ARGV, INIT, POLL, anything)
    await flush()
    fs.put(LOCK, encodeLock({ pid: 1, at: T0, token: 'thief' }))
    hung[0]?.(ok('[1]'))
    await winner
    expect(fs.has(LOCK)).toBe(true)
  })

  const uncached: [string, (call: number) => RunResult | Error, (stdout: string) => boolean][] = [
    ['a non-zero exit', () => fail('boom'), anything],
    ['output the caller rejects', () => ok('junk'), () => false],
    ['a runner that throws', () => new Error('timeout'), anything],
  ]
  for (const [name, answer, accept] of uncached) {
    test(`${name} is not cached, and the lock is released`, async () => {
      const { fs, gh } = setup(answer)
      await gh(ARGV, INIT, POLL, accept)
      expect(fs.has(ENTRY)).toBe(false)
      expect(fs.has(LOCK)).toBe(false)
    })
  }

  test('inside the shared rate-limit window: suspended, no gh call, no lock taken', async () => {
    const { backoff, gh, calls, fs } = setup()
    await backoff.write({ until: T0 + 60_000, attempts: 1, limit: 'primary' })
    expect(await gh(ARGV, INIT, POLL, anything)).toEqual({ kind: 'suspended', limit: 'primary', until: T0 + 60_000 })
    expect(calls).toEqual([])
    expect(fs.creates).toEqual([])
  })

  test('a window set while a loser waited stops its own fetch', async () => {
    const { backoff, gh, calls, hung, clock } = setup(call => (call === 1 ? 'hang' : ok('[2]')))
    void gh(ARGV, INIT, POLL, anything)
    await flush()
    const loser = gh(ARGV, INIT, POLL, anything)
    await flush()
    await clock.advance(500)
    await backoff.write({ until: T0 + 60_000, attempts: 1, limit: 'secondary' })
    await clock.advance(1_500)
    expect((await loser).kind).toBe('suspended')
    expect(calls.length).toBe(1)
    expect(hung.length).toBe(1)
  })

  test('pruning removes this plugin files over a day old, once an hour, and leaves the rest', async () => {
    const { fs, gh, clock } = setup()
    const old = T0 - DAY - 1
    fs.put(`${DIR}/aaaa.json`, '{}', old)
    fs.put(`${DIR}/aaaa.lock`, '{}', old)
    fs.put(`${DIR}/aaaa.json.tmp.12`, '{}', old)
    fs.put(`${DIR}/rate-limit.json`, '{}', old)
    fs.put(`${DIR}/bbbb.json`, '{}', T0 - DAY + 1000)
    fs.put(`${DIR}/notes.txt`, 'mine', old)
    await gh(ARGV, INIT, POLL, anything)
    expect(fs.paths()).toEqual([`${DIR}/bbbb.json`, ENTRY, `${DIR}/notes.txt`].sort())

    fs.put(`${DIR}/cccc.json`, '{}', old)
    await clock.advance(11_000)
    await gh([...ARGV, '--x'], INIT, POLL, anything)
    expect(fs.has(`${DIR}/cccc.json`)).toBe(true)
    await clock.advance(60 * 60 * 1000)
    await gh([...ARGV, '--y'], INIT, POLL, anything)
    expect(fs.has(`${DIR}/cccc.json`)).toBe(false)
  })
})
