import { describe, expect, test } from 'claude-code/testing'
import { fakeCacheFs } from '../testing/cache-fs'
import { BACKOFF_CEILING_MS, fileBackoff, isInWindow, memoryBackoff } from './backoff-store'
import { encodeBackoff } from './cache-entry'

const NOW = 5_000_000
const DIR = '/cache/github-actions-pane'
const PATH = `${DIR}/rate-limit.json`
const window = { until: NOW + 60_000, attempts: 1, limit: 'secondary' as const }

const setup = (dir: string | null = DIR) => {
  const fs = fakeCacheFs(() => NOW)
  const logged: string[] = []
  return { fs, logged, store: fileBackoff(fs, async () => dir, async () => NOW, text => void logged.push(text)) }
}

describe('isInWindow', () => {
  test('inside until, less the timer slack', () => {
    expect(isInWindow(window, NOW)).toBe(true)
    expect(isInWindow(window, window.until - 50)).toBe(false)
    expect(isInWindow(window, window.until - 51)).toBe(true)
    expect(isInWindow(null, NOW)).toBe(false)
  })
})

describe('memoryBackoff', () => {
  test('keeps a window; clearIf drops it only while it is still that window', async () => {
    const store = memoryBackoff()
    expect(await store.read()).toBe(null)
    await store.write(window)
    expect(await store.read()).toEqual(window)
    await store.clearIf(window.until + 1)
    expect(await store.read()).toEqual(window)
    await store.clearIf(window.until)
    expect(await store.read()).toBe(null)
  })
})

describe('fileBackoff', () => {
  test('one file every store over the dir shares', async () => {
    const { fs, store } = setup()
    const other = fileBackoff(fs, async () => DIR, async () => NOW)
    await store.write(window)
    expect(fs.has(PATH)).toBe(true)
    expect(await other.read()).toEqual(window)
  })
  test('clearIf removes the file only while it holds that window', async () => {
    const { fs, store } = setup()
    await store.write(window)
    await store.clearIf(window.until + 1)
    expect(fs.has(PATH)).toBe(true)
    await store.clearIf(window.until)
    expect(fs.has(PATH)).toBe(false)
  })
  test('a corrupt file is no window', async () => {
    const { fs, store } = setup()
    fs.put(PATH, '{nope')
    expect(await store.read()).toBe(null)
  })
  test('a far-future window is cut to the ceiling', async () => {
    const { fs, store } = setup()
    fs.put(PATH, encodeBackoff({ ...window, until: NOW * 100 }, NOW))
    expect((await store.read())?.until).toBe(NOW + BACKOFF_CEILING_MS)
  })
  test('with no usable cache dir the window lives in this process only', async () => {
    const { fs, store } = setup(null)
    await store.write(window)
    expect(fs.paths()).toEqual([])
    expect(await store.read()).toEqual(window)
  })

  test('a failed write is logged, not thrown, and the window is still honoured from memory', async () => {
    const { fs, store, logged } = setup()
    fs.failNextWrite()
    await store.write(window)
    expect(logged.length).toBe(1)
    expect(fs.has(PATH)).toBe(false)
    expect(await store.read()).toEqual(window)
  })

  test('read answers the later of the file window and this process own', async () => {
    const { fs, store } = setup()
    fs.failNextWrite()
    await store.write(window)
    fs.put(PATH, encodeBackoff({ ...window, until: window.until + 1000, attempts: 3 }, NOW))
    expect((await store.read())?.until).toBe(window.until + 1000)
    fs.put(PATH, encodeBackoff({ ...window, until: window.until - 1000 }, NOW))
    expect((await store.read())?.until).toBe(window.until)
  })

  test('a failed remove is logged, not thrown, and the process drops its own window', async () => {
    const { fs, store, logged } = setup()
    await store.write(window)
    fs.failNextRemove()
    await store.clearIf(window.until)
    expect(logged.length).toBe(1)
    expect(fs.has(PATH)).toBe(true)
    fs.put(PATH, '{nope')
    expect(await store.read()).toBe(null)
  })

  test('an unreadable dir reads as no window from the file, not a throw', async () => {
    const fs = fakeCacheFs(() => NOW)
    const store = fileBackoff({ ...fs, read: async () => Promise.reject(new Error('EIO')) }, async () => DIR, async () => NOW)
    expect(await store.read()).toBe(null)
  })
})
