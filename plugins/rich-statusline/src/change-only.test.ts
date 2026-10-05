import { describe, expect, test } from 'claude-code/testing'
import { changeOnly, updateOnly } from './change-only'
import { deferred, flush } from './testing/ports'

describe('changeOnly', () => {
  test('skips a write equal to the held value', async () => {
    const writes: string[] = []
    const set = changeOnly(async () => 'x', async (value: string) => void writes.push(value))
    await set('x')
    await set('y')
    expect(writes).toEqual(['y'])
  })

  test('concurrent writers land in call order: the last call wins', async () => {
    let held = 'x'
    const slowRead = deferred<void>()
    const set = changeOnly(
      async () => {
        await slowRead.promise
        return held
      },
      async (value: string) => {
        held = value
      },
    )
    const first = set('y')
    const second = set('x')
    slowRead.resolve()
    await Promise.all([first, second])
    await flush()
    expect(held).toBe('x')
  })

  test('a rejecting read or write fails that call alone; the next call still works', async () => {
    let held = 'x'
    let failures = ['get', 'write']
    const set = changeOnly(
      async () => {
        if (failures[0] === 'get') {
          failures = failures.slice(1)
          throw new Error('read failed')
        }
        return held
      },
      async (value: string) => {
        if (failures[0] === 'write') {
          failures = failures.slice(1)
          throw new Error('write failed')
        }
        held = value
      },
    )
    await expect(set('y')).rejects.toThrow('read failed')
    await expect(set('y')).rejects.toThrow('write failed')
    await set('z')
    expect(held).toBe('z')
  })

  test('the updater form skips a change that leaves the value as held', async () => {
    let held = 1
    let writes = 0
    const apply = updateOnly(
      async () => held,
      async (change: (value: number) => number) => {
        writes += 1
        held = change(held)
      },
    )
    await apply(value => value)
    await apply(value => value + 1)
    expect([held, writes]).toEqual([2, 1])
  })
})
