import { describe, expect, test } from 'claude-code/testing'
import {
  cacheDir,
  cacheKey,
  decodeBackoff,
  decodeEntry,
  decodeLock,
  encodeBackoff,
  encodeEntry,
  encodeLock,
  isFresh,
  isLockStale,
} from './cache-entry'

const HOST = 'github.com'
const ARGV = ['gh', 'run', 'list', '--repo', 'acme/widgets']
const NOW = 1_000_000
const entry = { host: HOST, argv: ARGV, at: NOW, stdout: '[]' }
const alive = async () => true
const dead = async () => false

describe('cacheKey', () => {
  test('is stable, and changes with the host or any argument', () => {
    expect(cacheKey(HOST, ARGV)).toBe(cacheKey(HOST, [...ARGV]))
    expect(cacheKey(HOST, ARGV)).toMatch(/^[0-9a-f]{16}$/)
    expect(cacheKey('ghe.example.com', ARGV)).not.toBe(cacheKey(HOST, ARGV))
    expect(cacheKey(HOST, [...ARGV, '--limit', '20'])).not.toBe(cacheKey(HOST, ARGV))
  })
  test('argument boundaries matter', () => {
    expect(cacheKey(HOST, ['a', 'bc'])).not.toBe(cacheKey(HOST, ['ab', 'c']))
  })
})

describe('decodeEntry', () => {
  test('round-trips an entry', () => {
    expect(decodeEntry(encodeEntry(entry), HOST, ARGV)).toEqual(entry)
  })
  test('every corrupt shape is a miss', () => {
    const good = JSON.parse(encodeEntry(entry))
    const bad = [
      'not json',
      '[]',
      'null',
      JSON.stringify({ ...good, v: 2 }),
      JSON.stringify({ ...good, host: 'other.example.com' }),
      JSON.stringify({ ...good, argv: ['gh', 'other'] }),
      JSON.stringify({ ...good, at: 'soon' }),
      JSON.stringify({ ...good, at: null }),
      JSON.stringify({ ...good, stdout: 5 }),
      JSON.stringify({ ...good, argv: 'gh' }),
    ]
    for (const text of bad) expect(decodeEntry(text, HOST, ARGV)).toBe(null)
  })
})

describe('isFresh', () => {
  const fresh = { maxAgeMs: 10_000, kickAt: null }
  test('younger than the interval less a second of slack', () => {
    expect(isFresh(entry, NOW + 8_999, fresh)).toBe(true)
    expect(isFresh(entry, NOW + 9_000, fresh)).toBe(false)
  })
  test('a kick accepts only an entry written at or after it', () => {
    expect(isFresh(entry, NOW + 100, { ...fresh, kickAt: NOW })).toBe(true)
    expect(isFresh(entry, NOW + 100, { ...fresh, kickAt: NOW + 1 })).toBe(false)
  })
  test('an entry written before the kick is stale however young, and one after it stays fresh however old the interval says', () => {
    expect(isFresh(entry, NOW + 600, { ...fresh, kickAt: NOW + 500 })).toBe(false)
    expect(isFresh(entry, NOW + 20_000, { maxAgeMs: 10_000, kickAt: NOW })).toBe(true)
  })
  test('a kick still refuses an entry dated in the future', () => {
    expect(isFresh(entry, NOW - 1, { ...fresh, kickAt: NOW - 5 })).toBe(false)
  })
  test('an entry dated in the future is stale', () => {
    expect(isFresh(entry, NOW - 1, fresh)).toBe(false)
  })
})

describe('locks', () => {
  const lock = { pid: 4242, at: NOW, token: 'abc' }
  test('round-trips; junk is null', () => {
    expect(decodeLock(encodeLock(lock))).toEqual(lock)
    expect(decodeLock(encodeLock({ ...lock, pid: null }))).toEqual({ ...lock, pid: null })
    expect(decodeLock('garbage')).toBe(null)
    expect(decodeLock(JSON.stringify({ v: 1, pid: 'x', at: NOW, token: 't' }))).toBe(null)
    expect(decodeLock(JSON.stringify({ v: 1, pid: 1, at: NOW }))).toBe(null)
  })
  test('stale past 30s, with a dead pid, or when unparsable', async () => {
    expect(await isLockStale(lock, NOW + 30_000, alive)).toBe(false)
    expect(await isLockStale(lock, NOW + 30_001, alive)).toBe(true)
    expect(await isLockStale(lock, NOW + 1, dead)).toBe(true)
    expect(await isLockStale(null, NOW, alive)).toBe(true)
  })
  test('a lock with no pid is held until the 30s rule', async () => {
    expect(await isLockStale({ ...lock, pid: null }, NOW + 29_000, dead)).toBe(false)
    expect(await isLockStale({ ...lock, pid: null }, NOW + 30_001, dead)).toBe(true)
  })
})

describe('cacheDir', () => {
  test('XDG_CACHE_HOME when absolute, else ~/.cache', () => {
    expect(cacheDir({ xdg: '/x/cache', home: '/h' })).toBe('/x/cache/github-actions-pane')
    expect(cacheDir({ xdg: '/x/cache/', home: '/h' })).toBe('/x/cache/github-actions-pane')
    expect(cacheDir({ xdg: undefined, home: '/h' })).toBe('/h/.cache/github-actions-pane')
    expect(cacheDir({ xdg: '', home: '/h' })).toBe('/h/.cache/github-actions-pane')
  })
  test('a relative XDG path is ignored', () => {
    expect(cacheDir({ xdg: 'rel/cache', home: '/h' })).toBe('/h/.cache/github-actions-pane')
  })
  test('no usable place is null', () => {
    expect(cacheDir({ xdg: undefined, home: undefined })).toBe(null)
    expect(cacheDir({ xdg: undefined, home: 'relative' })).toBe(null)
  })
})

describe('decodeBackoff', () => {
  const window = { until: NOW + 60_000, attempts: 2, limit: 'secondary' as const }
  test('round-trips', () => {
    expect(decodeBackoff(encodeBackoff(window, NOW), NOW + 1_000_000)).toEqual(window)
  })
  test('corrupt is no window', () => {
    const bad = [
      'x',
      '[]',
      JSON.stringify({ v: 1, until: 'n', attempts: 1, limit: 'primary' }),
      JSON.stringify({ v: 1, until: 5, attempts: 1, limit: 'weird' }),
      JSON.stringify({ v: 1, until: 5, attempts: 0.5, limit: 'primary' }),
      JSON.stringify({ v: 9, until: 5, attempts: 1, limit: 'primary' }),
    ]
    for (const text of bad) expect(decodeBackoff(text, NOW)).toBe(null)
  })
  test('until is clamped to the ceiling', () => {
    expect(decodeBackoff(encodeBackoff({ ...window, until: NOW * 100 }, NOW), NOW + 5_000)?.until).toBe(NOW + 5_000)
  })
})
