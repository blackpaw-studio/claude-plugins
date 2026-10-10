import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_SETTINGS } from './settings'
import { KICK_MS, nextPollMs } from './schedule'

const NOW = 1_000_000
const base = { settings: DEFAULT_SETTINGS, isActive: false, isRateLimited: false, kickUntil: 0, now: NOW }

describe('nextPollMs', () => {
  test('idle rate with nothing active, active rate while a run is', () => {
    expect(nextPollMs(base)).toBe(60_000)
    expect(nextPollMs({ ...base, isActive: true })).toBe(10_000)
  })
  test('a push kick polls at the active rate for two minutes', () => {
    expect(KICK_MS).toBe(120_000)
    expect(nextPollMs({ ...base, kickUntil: NOW + 1 })).toBe(10_000)
    expect(nextPollMs({ ...base, kickUntil: NOW })).toBe(60_000)
  })
  test('a rate limit backs off to the idle rate whatever is active', () => {
    expect(nextPollMs({ ...base, isActive: true, isRateLimited: true, kickUntil: NOW + 1 })).toBe(60_000)
  })
})
