import { describe, expect, test } from 'claude-code/testing'
import { coalesce } from './coalesce'
import { deferred, flush } from './testing/ports'

const microtasks = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i += 1) await Promise.resolve()
}

describe('coalesce', () => {
  test('a call at any moment after a pass finishes still runs', async () => {
    for (let gap = 0; gap < 12; gap += 1) {
      let runs = 0
      const run = coalesce(async () => {
        runs += 1
      })
      void run()
      await microtasks(gap)
      void run()
      await flush()
      expect(runs, `gap of ${gap} microtasks`).toBe(2)
    }
  })

  test('a rejecting pass still runs the queued one, then rejects', async () => {
    const hold = deferred<void>()
    let runs = 0
    const run = coalesce(async () => {
      runs += 1
      if (runs === 1) {
        await hold.promise
        throw new Error('first failed')
      }
    })
    const first = run()
    const second = run()
    hold.resolve()
    await expect(first).rejects.toThrow('first failed')
    await expect(second).rejects.toThrow('first failed')
    expect(runs).toBe(2)
  })
})
