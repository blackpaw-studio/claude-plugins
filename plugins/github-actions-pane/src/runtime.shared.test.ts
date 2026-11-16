// The runtime on state shared with other sessions: the rate-limit window in a
// store every session reads, and the freshness each gh call is made with.
import { describe, expect, test } from 'claude-code/testing'
import type { ActionsRun } from '../types'
import { BACKOFF_CEILING_MS, type BackoffStore, fileBackoff, memoryBackoff } from './collect/backoff-store'
import type { Run } from './collect/run'
import { createSharedGh, directGh, type GhPort } from './collect/shared-gh'
import { createRuntime } from './runtime'
import { DEFAULT_SETTINGS, type Settings } from './settings'
import { dataOf, ghRun, MINUTE, runOf, SECOND, T0 } from './testing/builders'
import { fakeCacheFs } from './testing/cache-fs'
import { fakeClock, fakeWorld, type FakeWorld, flush } from './testing/ports'
import { fail, ok } from './testing/runner'

const LIST = 'gh run list'
const SECONDARY = 'HTTP 403: You have exceeded a secondary rate limit.'
const AUTO_OPEN: Settings = { ...DEFAULT_SETTINGS, autoOpen: true }
const RUNNING = runOf({ id: 482, createdAt: T0, startedAt: T0 })
const runsAre = (world: FakeWorld, runs: readonly ActionsRun[]) => world.answers.set(LIST, ok(JSON.stringify(runs.map(ghRun))))
const asked = (world: FakeWorld) => world.asked.filter(argv => argv.startsWith('gh'))
const WINDOW = { until: T0 + 5 * MINUTE, attempts: 1, limit: 'secondary' as const }

/** A world whose gh port records the freshness of each call. */
const recording = (backoff: BackoffStore = memoryBackoff(), settings: Settings = AUTO_OPEN, beforeCall: () => Promise<void> = async () => undefined) => {
  const fresh: unknown[] = []
  let inner: GhPort = async () => ({ kind: 'failed', message: 'not wired' })
  const world = fakeWorld(T0, {
    backoff,
    gh: async (argv, init, asked, accept) => {
      fresh.push(asked)
      await beforeCall()
      return inner(argv, init, asked, accept)
    },
  })
  inner = directGh(world.ports.run)
  return { world, runtime: createRuntime(world.ports, settings), fresh, backoff }
}

describe('a rate-limit window from the shared store', () => {
  test('another session window holds this one off, and says so, until it ends', async () => {
    const backoff = memoryBackoff()
    await backoff.write(WINDOW)
    const { world, runtime } = recording(backoff)
    await runtime.start()
    expect(asked(world)).toEqual([])
    expect(world.data()).toMatchObject({ isRateLimited: true, rateLimitedUntil: WINDOW.until })
    await world.advance(5 * MINUTE)
    expect(asked(world)).toEqual([])
    await world.advance(5 * MINUTE + SECOND)
    expect(asked(world).length).toBeGreaterThan(0)
    expect(world.data()).toMatchObject({ isRateLimited: false, rateLimitedUntil: null })
    expect(await backoff.read()).toBe(null)
  })

  test('a limit this session meets goes into the store, for the others', async () => {
    const { world, runtime, backoff } = recording()
    runsAre(world, [RUNNING])
    world.answers.set('gh run view 482 --repo', ok('{"jobs":[]}'))
    await runtime.start()
    world.answers.set(LIST, fail(SECONDARY))
    await world.advance(10 * SECOND)
    expect(await backoff.read()).toEqual({ until: world.now() + 60 * SECOND, attempts: 1, limit: 'secondary' })
  })

  test('a hit met while another session window is already on joins it instead of starting a new one', async () => {
    const backoff = memoryBackoff()
    // The other session's limit lands while this poll's list call is out.
    const { world, runtime } = recording(backoff, AUTO_OPEN, () => backoff.write({ ...WINDOW, attempts: 4 }))
    runsAre(world, [RUNNING])
    world.answers.set(LIST, fail(SECONDARY))
    await runtime.start()
    expect(await backoff.read()).toEqual({ ...WINDOW, attempts: 4 })
    expect(world.data()).toMatchObject({ isRateLimited: true, rateLimitedUntil: WINDOW.until })
  })

  test('a window restored from state seeds an empty store', async () => {
    const { world, runtime, backoff } = recording()
    await world.ports.data.set(dataOf({ isRateLimited: true, rateLimitedUntil: T0 + 20 * MINUTE }))
    await runtime.start()
    expect((await backoff.read())?.until).toBe(T0 + 20 * MINUTE)
    expect(asked(world)).toEqual([])
  })

  test('a window restored from state does not shorten a later one already stored', async () => {
    const backoff = memoryBackoff()
    await backoff.write({ ...WINDOW, until: T0 + 40 * MINUTE })
    const { world, runtime } = recording(backoff)
    await world.ports.data.set(dataOf({ isRateLimited: true, rateLimitedUntil: T0 + 20 * MINUTE }))
    await runtime.start()
    expect((await backoff.read())?.until).toBe(T0 + 40 * MINUTE)
  })

  test('a restored window is cut to the ceiling before it is shared', async () => {
    const { world, runtime, backoff } = recording()
    await world.ports.data.set(dataOf({ isRateLimited: true, rateLimitedUntil: T0 + 24 * 60 * MINUTE }))
    await runtime.start()
    expect((await backoff.read())?.until).toBe(T0 + BACKOFF_CEILING_MS)
  })
})

describe('the freshness a poll asks for', () => {
  test('its own cadence: hidden idle with the pane closed', async () => {
    const { world, runtime, fresh } = recording(memoryBackoff(), DEFAULT_SETTINGS)
    runsAre(world, [])
    await runtime.start()
    expect(fresh.length).toBeGreaterThan(0)
    for (const asked of fresh) expect(asked).toEqual({ maxAgeMs: DEFAULT_SETTINGS.hiddenIdlePollMs, kickAt: null })
  })

  test('the active cadence while a run executes', async () => {
    const { world, runtime, fresh } = recording()
    runsAre(world, [RUNNING])
    world.answers.set('gh run view 482 --repo', ok('{"jobs":[]}'))
    await runtime.start()
    fresh.length = 0
    await world.advance(10 * SECOND)
    expect(fresh.length).toBeGreaterThan(0)
    for (const asked of fresh) expect(asked).toEqual({ maxAgeMs: DEFAULT_SETTINGS.activePollMs, kickAt: null })
  })

  test('a kick says so for its own poll only, at the active cadence', async () => {
    const { world, runtime, fresh } = recording(memoryBackoff(), DEFAULT_SETTINGS)
    runsAre(world, [])
    await runtime.start()
    fresh.length = 0
    const kickedAt = world.now()
    await runtime.kick()
    expect(fresh.length).toBeGreaterThan(0)
    for (const asked of fresh) expect(asked).toEqual({ maxAgeMs: DEFAULT_SETTINGS.activePollMs, kickAt: kickedAt })
    fresh.length = 0
    await world.advance(10 * SECOND)
    expect(fresh.length).toBeGreaterThan(0)
    for (const asked of fresh) expect(asked).toMatchObject({ kickAt: null })
  })
})

/**
 * Sessions on one machine: one clock, one cache dir, one rate-limit file, one
 * gh (answered from the first world's table), each session with its own
 * SharedGh and the number of gh calls it actually made.
 */
const CACHE_DIR = '/cache/github-actions-pane'
const BRANCH_LIST = 'gh run list --repo acme/widgets --limit 20 --json'

const machine = (sessions: readonly { isPaneOpen?: boolean }[], settings: Settings = DEFAULT_SETTINGS) => {
  const clock = fakeClock(T0)
  const fs = fakeCacheFs(clock.now)
  const backoff = fileBackoff(fs, async () => CACHE_DIR, async () => clock.now())
  const gh = fakeWorld(T0, {}, clock)
  const fetches = sessions.map(() => 0)
  const worlds = sessions.map((session, index) => {
    const run: Run = (argv, init) => {
      if (argv[0] === 'gh') fetches[index] = (fetches[index] ?? 0) + 1
      return gh.ports.run(argv, init)
    }
    const shared = createSharedGh({
      run,
      fs,
      backoff,
      now: async () => clock.now(),
      sleep: ms => new Promise<void>(resolve => void clock.after(ms, resolve)),
      isAlive: async () => true,
      pid: async () => 1000 + index,
      host: async () => 'github.com',
      dir: async () => CACHE_DIR,
      log: () => undefined,
    })
    const world = fakeWorld(T0, { run: gh.ports.run, gh: shared, backoff }, clock)
    // Held open by hand: an auto pane with nothing running would close itself.
    if (session.isPaneOpen === true) {
      world.setPane({ isOpen: true, isPlaced: true })
      void world.ports.manual.set(true)
    }
    return { world, runtime: createRuntime(world.ports, settings) }
  })
  /** Starts every session at once; a session that loses the lock waits on the clock, so the clock must move. */
  const startAll = async (): Promise<void> => {
    const started = worlds.map(one => one.runtime.start())
    await flush()
    await clock.advance(SECOND)
    await Promise.all(started)
  }
  /** The branch lists asked of GitHub, across every session. */
  const lists = () => gh.asked.filter(argv => argv.startsWith(BRANCH_LIST) && argv.includes('--branch ')).length
  return { clock, fs, backoff, gh, worlds, fetches, lists, startAll }
}

describe('sessions sharing one machine', () => {
  test('three sessions on one repo make one list per interval, not three', async () => {
    const { clock, lists, startAll } = machine([{}, {}, {}])
    await startAll()
    expect(lists()).toBe(1)
    await clock.advance(5 * DEFAULT_SETTINGS.hiddenIdlePollMs)
    expect(lists()).toBe(6)
  })

  test('the session polling fastest makes every fetch; a hidden one makes none', async () => {
    const { clock, worlds, fetches } = machine([{ isPaneOpen: true }, {}])
    await worlds[0]?.runtime.start()
    await worlds[1]?.runtime.start()
    await clock.advance(10 * MINUTE)
    expect(fetches[1]).toBe(0)
    // Every 60s from the start through the tenth minute.
    expect(fetches[0]).toBe(11 * 2)
  })

  test('a kicked session drives while an idle one with its pane open reuses', async () => {
    const { clock, worlds, fetches } = machine([{}, { isPaneOpen: true }])
    await worlds[0]?.runtime.start()
    await worlds[1]?.runtime.start()
    await clock.advance(SECOND)
    await worlds[0]?.runtime.kick()
    await clock.advance(100 * SECOND)
    expect(fetches[1]).toBe(0)
    expect(fetches[0]).toBeGreaterThan(8 * 2)
  })

  test('a limit met by one session suspends every session until the window ends, then both resume', async () => {
    const { clock, worlds, gh, lists, fs, startAll } = machine([{ isPaneOpen: true }, { isPaneOpen: true }])
    await startAll()
    expect(lists()).toBe(1)
    gh.answers.set(LIST, fail(SECONDARY))
    // Their next polls, a minute on: the first is refused, the second is held off by it.
    await clock.advance(MINUTE + SECOND)
    expect(lists()).toBe(2)
    const until = worlds[0]?.world.data()?.rateLimitedUntil ?? 0
    expect(until).toBeGreaterThan(clock.now())
    expect(worlds[1]?.world.data()).toMatchObject({ isRateLimited: true, rateLimitedUntil: until })
    await clock.advance(until - clock.now() - SECOND)
    expect(lists()).toBe(2)
    gh.answers.set(LIST, ok('[]'))
    await clock.advance(10 * SECOND + MINUTE)
    expect(lists()).toBeGreaterThan(2)
    for (const one of worlds) expect(one.world.data()).toMatchObject({ isRateLimited: false, rateLimitedUntil: null })
    expect(fs.has(`${CACHE_DIR}/rate-limit.json`)).toBe(false)
  })

  test('two kicks within a second make one fetch', async () => {
    const { clock, worlds, lists, startAll } = machine([{}, {}])
    await startAll()
    await clock.advance(5 * SECOND)
    const before = lists()
    await Promise.all(worlds.map(one => one.runtime.kick()))
    await flush()
    expect(lists() - before).toBe(1)
  })

  test('a corrupt entry dropped in mid-run costs one live fetch, then all is as before', async () => {
    const { clock, fs, lists, startAll } = machine([{}, {}])
    await startAll()
    expect(lists()).toBe(1)
    for (const path of fs.paths().filter(one => one.endsWith('.json'))) fs.put(path, '{"v":1,"host":')
    await clock.advance(DEFAULT_SETTINGS.hiddenIdlePollMs + SECOND)
    expect(lists()).toBe(2)
    await clock.advance(DEFAULT_SETTINGS.hiddenIdlePollMs)
    expect(lists()).toBe(3)
  })
})

/** One session whose rate-limit file lives on a cache fs that can be made to fail. */
const onFailingFs = (backoffOf?: (fs: ReturnType<typeof fakeCacheFs>, clock: ReturnType<typeof fakeClock>) => BackoffStore) => {
  const clock = fakeClock(T0)
  const fs = fakeCacheFs(clock.now)
  const backoff = backoffOf?.(fs, clock) ?? fileBackoff(fs, async () => CACHE_DIR, async () => clock.now())
  const world = fakeWorld(T0, { backoff }, clock)
  const runtime = createRuntime(world.ports, AUTO_OPEN)
  const lists = () => world.asked.filter(argv => argv.startsWith('gh run list') && argv.includes('--branch ')).length
  runsAre(world, [RUNNING])
  world.answers.set('gh run view 482 --repo', ok('{"jobs":[]}'))
  return { clock, fs, backoff, world, runtime, lists }
}

describe('a rate-limit file that cannot be written', () => {
  test('a failed write does not stop polling: the session resumes after its window', async () => {
    const { clock, fs, world, runtime, lists } = onFailingFs()
    await runtime.start()
    fs.failNextWrite()
    world.answers.set(LIST, fail(SECONDARY))
    await clock.advance(10 * SECOND)
    const hit = lists()
    world.answers.set(LIST, ok(JSON.stringify([ghRun(RUNNING)])))
    await clock.advance(61 * SECOND)
    expect(lists()).toBeGreaterThan(hit)
    expect(world.data()).toMatchObject({ isRateLimited: false, rateLimitedUntil: null })
  })

  test('the session still honours its own window: a kick inside it makes no gh call', async () => {
    const { clock, fs, world, runtime, lists } = onFailingFs()
    await runtime.start()
    fs.failNextWrite()
    world.answers.set(LIST, fail(SECONDARY))
    await clock.advance(10 * SECOND)
    const hit = lists()
    await runtime.kick()
    expect(lists()).toBe(hit)
    expect(world.data()?.isRateLimited).toBe(true)
  })

  test('a failed remove at the end of a window does not stop polling', async () => {
    const { clock, fs, world, runtime, lists } = onFailingFs()
    await runtime.start()
    world.answers.set(LIST, fail(SECONDARY))
    await clock.advance(10 * SECOND)
    world.answers.set(LIST, ok(JSON.stringify([ghRun(RUNNING)])))
    fs.failNextRemove()
    await clock.advance(60 * SECOND)
    const resumed = lists()
    await clock.advance(10 * SECOND)
    expect(lists()).toBeGreaterThan(resumed)
    expect(world.data()).toMatchObject({ isRateLimited: false, rateLimitedUntil: null })
  })

  test('whatever a poll throws, the next one is still scheduled', async () => {
    const { clock, world, runtime, lists } = onFailingFs(() => ({
      ...memoryBackoff(),
      write: async () => Promise.reject(new Error('store is broken')),
    }))
    await runtime.start()
    world.answers.set(LIST, fail(SECONDARY))
    await clock.advance(10 * SECOND)
    world.answers.set(LIST, ok(JSON.stringify([ghRun(RUNNING)])))
    const hit = lists()
    await clock.advance(120 * SECOND)
    expect(lists()).toBeGreaterThan(hit)
  })
})
