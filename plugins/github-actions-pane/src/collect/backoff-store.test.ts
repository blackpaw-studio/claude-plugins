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
  return { fs, store: fileBackoff(fs, async () => dir, async () => NOW) }
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
})
