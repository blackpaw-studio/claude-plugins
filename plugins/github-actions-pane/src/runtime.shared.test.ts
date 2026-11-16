// The runtime on state shared with other sessions: the rate-limit window in a
// store every session reads, and the freshness each gh call is made with.
import { describe, expect, test } from 'claude-code/testing'
import type { ActionsRun } from '../types'
import { BACKOFF_CEILING_MS, type BackoffStore, memoryBackoff } from './collect/backoff-store'
import { directGh, type GhPort } from './collect/shared-gh'
import { createRuntime } from './runtime'
import { DEFAULT_SETTINGS, type Settings } from './settings'
import { dataOf, ghRun, MINUTE, runOf, SECOND, T0 } from './testing/builders'
import { fakeWorld, type FakeWorld } from './testing/ports'
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
    for (const asked of fresh) expect(asked).toEqual({ maxAgeMs: DEFAULT_SETTINGS.hiddenIdlePollMs, isKick: false })
  })

  test('the active cadence while a run executes', async () => {
    const { world, runtime, fresh } = recording()
    runsAre(world, [RUNNING])
    world.answers.set('gh run view 482 --repo', ok('{"jobs":[]}'))
    await runtime.start()
    fresh.length = 0
    await world.advance(10 * SECOND)
    expect(fresh.length).toBeGreaterThan(0)
    for (const asked of fresh) expect(asked).toEqual({ maxAgeMs: DEFAULT_SETTINGS.activePollMs, isKick: false })
  })

  test('a kick says so for its own poll only, at the active cadence', async () => {
    const { world, runtime, fresh } = recording(memoryBackoff(), DEFAULT_SETTINGS)
    runsAre(world, [])
    await runtime.start()
    fresh.length = 0
    await runtime.kick()
    expect(fresh.length).toBeGreaterThan(0)
    for (const asked of fresh) expect(asked).toEqual({ maxAgeMs: DEFAULT_SETTINGS.activePollMs, isKick: true })
    fresh.length = 0
    await world.advance(10 * SECOND)
    expect(fresh.length).toBeGreaterThan(0)
    for (const asked of fresh) expect(asked).toMatchObject({ isKick: false })
  })
})
