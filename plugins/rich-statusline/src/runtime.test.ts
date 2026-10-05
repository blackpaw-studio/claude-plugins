import { describe, expect, test } from 'claude-code/testing'
import { createRuntime } from './runtime'
import { answerFor, fakeWorld, flush } from './testing/ports'

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

  test('timers start even when the settings state write fails', async () => {
    const world = fakeWorld({
      overrides: {
        settings: {
          set: async () => {
            throw new Error('denied')
          },
        },
      },
    })
    await started(world)
    expect(world.everyCount()).toBe(3)
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
