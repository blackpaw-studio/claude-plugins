// An in-memory CacheFs for tests: exclusive create, mtimes stamped from the
// test's clock, and a way to drop in corrupt files or old ones.
import type { CacheFileInfo, CacheFs } from '../collect/cache-fs'

export type FakeCacheFs = CacheFs & {
  /** Puts a file straight in (a corrupt one, an old one); `mtimeMs` defaults to now. */
  put: (path: string, text: string, mtimeMs?: number) => void
  has: (path: string) => boolean
  /** Every path held, sorted. */
  paths: () => string[]
  /** Every `createExclusive` asked, in order, with what it answered. */
  creates: { path: string; result: 'won' | 'held' | 'error' }[]
  /** The next `createExclusive` answers `error` without creating anything. */
  failNextCreate: () => void
}

export const fakeCacheFs = (now: () => number): FakeCacheFs => {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const creates: FakeCacheFs['creates'] = []
  let isFailingNext = false

  const put = (path: string, text: string, mtimeMs: number = now()): void => void files.set(path, { text, mtimeMs })

  return {
    put,
    has: path => files.has(path),
    paths: () => [...files.keys()].sort(),
    creates,
    failNextCreate: () => void (isFailingNext = true),
    read: async path => files.get(path)?.text ?? null,
    writeAtomic: async (path, text) => put(path, text),
    createExclusive: async (path, text) => {
      const result = isFailingNext ? 'error' : files.has(path) ? 'held' : 'won'
      isFailingNext = false
      creates.push({ path, result })
      if (result === 'won') put(path, text)
      return result
    },
    remove: async path => void files.delete(path),
    list: async (dir): Promise<CacheFileInfo[]> =>
      [...files.entries()]
        .filter(([path]) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/'))
        .map(([path, file]) => ({ name: path.slice(dir.length + 1), mtimeMs: file.mtimeMs })),
  }
}
