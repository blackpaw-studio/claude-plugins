import { describe, expect, test } from 'claude-code/testing'
import { createRuntime, TICK_MS } from './runtime'
import { DEFAULT_SETTINGS } from './settings'
import { answerFor, type Deferred, deferred, fakeWorld, flush } from './testing/ports'

/** Attaches and runs the deferred start. */
const started = async (world: ReturnType<typeof fakeWorld>) => {
  const runtime = createRuntime()
  runtime.attach(world.ports)
  world.fireAfter()
  await flush()
  return runtime
}

describe('runtime', () => {
  test('a git refresh does not wait on gh', async () => {
    const world = fakeWorld({ hold: ['gh'] })
    const runtime = await started(world)
    world.setCwd('/b')
    let isDone = false
    void runtime.cwdMaybeChanged().then(() => {
      isDone = true
    })
    await flush()
    expect(world.gitSets.map(g => g.root)).toEqual(['/a', '/b'])
    expect(isDone).toBe(true)
  })

  test('a cwd change during a refresh queues one rerun in the new cwd', async () => {
    const world = fakeWorld({ hold: ['git rev-parse --show-toplevel'] })
    const runtime = await started(world)
    world.setCwd('/b')
    void runtime.cwdMaybeChanged()
    await flush()
    world.calls.filter(c => c.argv.includes('--show-toplevel')).forEach(c => c.answer.resolve(answerFor(c.argv, c.cwd)))
    await flush()
    world.calls.filter(c => c.argv.includes('--show-toplevel')).forEach(c => c.answer.resolve(answerFor(c.argv, c.cwd)))
    await flush()
    expect(world.calls.filter(c => c.argv.includes('--show-toplevel')).map(c => c.cwd)).toEqual(['/a', '/b'])
    expect(world.gitSets.at(-1)?.root).toBe('/b')
  })

  test('a result read for a cwd that is no longer current is discarded', async () => {
    const world = fakeWorld({ hold: ['git rev-parse --show-toplevel'] })
    const runtime = await started(world)
    world.setCwd('/b')
    void runtime.cwdMaybeChanged()
    await flush()
    const first = world.calls.find(c => c.cwd === '/a' && c.argv.includes('--show-toplevel'))
    first?.answer.resolve(answerFor(first.argv, first.cwd))
    await flush()
    world.calls.filter(c => c.cwd === '/b').forEach(c => c.answer.resolve(answerFor(c.argv, c.cwd)))
    await flush()
    expect(world.gitSets.map(g => g.root)).toEqual(['/b'])
  })

  test('a failing settings read leaves the identity loaded', async () => {
    const world = fakeWorld({
      overrides: {
        configuredEffort: async () => {
          throw new Error('settings unreadable')
        },
      },
    })
    await started(world)
    expect(world.identity()).toEqual({ model: 'claude-opus-5-5', cwd: '/a', home: '/h' })
  })

  test('a new session still reads git when the identity read fails', async () => {
    let isBroken = false
    const world = fakeWorld({
      overrides: {
        model: async () => {
          if (isBroken) throw new Error('no model')
          return 'claude-opus-5-5'
        },
      },
    })
    const runtime = await started(world)
    isBroken = true
    const before = world.calls.length
    await runtime.sessionStarted()
    await flush()
    expect(world.calls.length).toBeGreaterThan(before)
  })

  test('gh runs in the repository root', async () => {
    const world = fakeWorld()
    world.setCwd('/a/sub')
    await started(world)
    expect(world.calls.find(c => c.argv.startsWith('gh'))?.cwd).toBe('/a')
  })

  test('identity changes from outside go through the serialized identity port', async () => {
    const changes: unknown[] = []
    const world = fakeWorld()
    const port = world.ports.identity
    const runtime = await started({
      ...world,
      ports: { ...world.ports, identity: { ...port, update: change => (changes.push(change), port.update(change)) } },
    })
    const before = changes.length
    await runtime.updateIdentity(held => (held === null ? held : { ...held, model: 'claude-sonnet-4-5' }))
    expect(changes.length).toBe(before + 1)
    expect(world.identity()?.model).toBe('claude-sonnet-4-5')
  })

  test('usage and settings from outside go through their ports', async () => {
    const written: string[] = []
    const world = fakeWorld()
    const runtime = await started({
      ...world,
      ports: {
        ...world.ports,
        usageState: { set: async () => void written.push('usage') },
        settings: { set: async () => void written.push('settings') },
      },
    })
    written.length = 0
    expect(await runtime.setUsage({ window: 200_000, rateLimits: [] })).toBe(true)
    expect(await runtime.setSettings(DEFAULT_SETTINGS)).toBe(true)
    expect(written).toEqual(['usage', 'settings'])
    expect(await createRuntime().setUsage({ window: 1, rateLimits: [] })).toBe(false)
  })

  test('a cleared session gets the stored settings and every collector again, with no new timers', async () => {
    const settingsSets: unknown[] = []
    const counts = { commands: 0, usages: 0 }
    const world = fakeWorld({
      overrides: {
        storedSettings: async () => ({ layout: '1c' }),
        settings: { set: async value => void settingsSets.push(value.layout) },
        registerCommand: async () => void (counts.commands += 1),
        usage: async () => ((counts.usages += 1), { context: { window: 200_000 }, rateLimits: [] }),
      },
    })
    const runtime = await started(world)
    const prSets = world.prSets.length
    runtime.sessionCleared()
    world.fireAfter()
    await flush()
    expect(settingsSets).toEqual(['1c', '1c'])
    expect(counts).toEqual({ commands: 2, usages: 2 })
    expect(world.gitSets).toHaveLength(2)
    // The PR is read again outright, not only when git looks changed.
    expect(world.prSets.length).toBeGreaterThan(prSets)
    expect(world.identity()?.cwd).toBe('/a')
    expect(world.everyCount()).toBe(3)
  })

  test('a clear while a seed runs folds into one more seed; nothing before attach', async () => {
    const reads: Deferred<unknown>[] = []
    const world = fakeWorld({ overrides: { storedSettings: () => (reads.push(deferred()), reads.at(-1)!.promise) } })
    const runtime = createRuntime()
    runtime.sessionCleared()
    runtime.stateMissing()
    world.fireAfter()
    expect(reads).toHaveLength(0)
    runtime.attach(world.ports)
    world.fireAfter()
    await flush()
    runtime.sessionCleared()
    runtime.sessionCleared()
    world.fireAfter()
    await flush()
    expect(reads).toHaveLength(1)
    reads.forEach(read => read.resolve(undefined))
    await flush()
    reads.forEach(read => read.resolve(undefined))
    await flush()
    expect(reads).toHaveLength(2)
  })

  test('a clear whose timer never ran does not block the next', async () => {
    let reads = 0
    const world = fakeWorld({ overrides: { storedSettings: async () => void (reads += 1) } })
    const runtime = await started(world)
    runtime.sessionCleared()
    world.dropAfter()
    runtime.sessionCleared()
    world.fireAfter()
    await flush()
    expect(reads).toBe(2)
  })

  test('missing state reseeds at most once a tick, however often it is reported', async () => {
    let reads = 0
    const world = fakeWorld({ overrides: { storedSettings: async () => void (reads += 1) } })
    const runtime = await started(world)
    const reportTwice = async () => {
      runtime.stateMissing()
      runtime.stateMissing()
      world.fireAfter()
      await flush()
    }
    await reportTwice()
    expect(reads).toBe(1)
    world.setNow(1 + TICK_MS)
    await reportTwice()
    await reportTwice()
    expect(reads).toBe(2)
  })

  test('a failing clock reads missing state as stale, so it still reseeds', async () => {
    let reads = 0
    const world = fakeWorld({
      overrides: {
        storedSettings: async () => void (reads += 1),
        now: async () => {
          throw new Error('no clock')
        },
      },
    })
    const runtime = await started(world)
    runtime.stateMissing()
    world.fireAfter()
    await flush()
    expect(reads).toBe(2)
  })

  test('a clear that seeds while a staleness check waits on the clock is not doubled', async () => {
    let reads = 0
    let clock: Deferred<number> | null = null
    const world = fakeWorld({
      overrides: {
        storedSettings: async () => void (reads += 1),
        now: () => (clock === null ? Promise.resolve(1) : clock.promise),
      },
    })
    const runtime = await started(world)
    clock = deferred()
    runtime.stateMissing()
    world.fireAfter()
    await flush()
    runtime.sessionCleared()
    world.fireAfter()
    await flush()
    clock.resolve(1 + TICK_MS)
    await flush()
    expect(reads).toBe(2)
  })

  test('a failed settings write stops the seed before the collectors, timers still started', async () => {
    const counts = { commands: 0, usages: 0 }
    const world = fakeWorld({
      overrides: {
        settings: {
          set: async () => {
            throw new Error('denied')
          },
        },
        registerCommand: async () => void (counts.commands += 1),
        usage: async () => ((counts.usages += 1), { context: { window: 200_000 }, rateLimits: [] }),
      },
    })
    await started(world)
    expect(counts).toEqual({ commands: 0, usages: 0 })
    expect(world.calls).toHaveLength(0)
    expect(world.identity()).toBe(null)
    expect(world.everyCount()).toBe(3)
  })

  test('a new session refreshes identity and git', async () => {
    const world = fakeWorld()
    const runtime = await started(world)
    world.setCwd('/c')
    await runtime.sessionStarted()
    await flush()
    expect(world.identity()?.cwd).toBe('/c')
    expect(world.gitSets.at(-1)?.root).toBe('/c')
  })
})
