import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_SETTINGS } from './settings'
import { KICK_MS, nextPollMs } from './schedule'

const NOW = 1_000_000
const base = { settings: DEFAULT_SETTINGS, isActive: false, isWaiting: false, isPaneOpen: true, suspendedForMs: 0, kickUntil: 0, now: NOW }

describe('nextPollMs', () => {
  test('idle rate with nothing active and the pane open, active rate while a run is', () => {
    expect(nextPollMs(base)).toBe(60_000)
    expect(nextPollMs({ ...base, isActive: true })).toBe(10_000)
  })
  test('nothing active and no pane: the slow hidden-idle rate', () => {
    expect(nextPollMs({ ...base, isPaneOpen: false })).toBe(600_000)
  })
  test('the active rate holds whether or not the pane is open', () => {
    expect(nextPollMs({ ...base, isActive: true, isPaneOpen: false })).toBe(10_000)
    expect(nextPollMs({ ...base, isActive: true, isPaneOpen: true })).toBe(10_000)
  })
  test('a push kick polls at the active rate for two minutes, pane or not', () => {
    expect(KICK_MS).toBe(120_000)
    expect(nextPollMs({ ...base, isPaneOpen: false, kickUntil: NOW + 1 })).toBe(10_000)
    expect(nextPollMs({ ...base, isPaneOpen: false, kickUntil: NOW })).toBe(600_000)
  })
  test('runs only waiting to start (queued, approval, pending) poll at the idle rate, pane or not', () => {
    expect(nextPollMs({ ...base, isWaiting: true, isPaneOpen: false })).toBe(60_000)
    expect(nextPollMs({ ...base, isWaiting: true, isPaneOpen: true })).toBe(60_000)
    expect(nextPollMs({ ...base, isWaiting: true, isActive: true, isPaneOpen: false })).toBe(10_000)
    expect(nextPollMs({ ...base, isWaiting: true, isPaneOpen: false, kickUntil: NOW + 1 })).toBe(10_000)
  })
  test('a suspension holds the next poll until it ends, whatever the cadence', () => {
    expect(nextPollMs({ ...base, isActive: true, kickUntil: NOW + 1, suspendedForMs: 90_000 })).toBe(90_000)
    expect(nextPollMs({ ...base, isPaneOpen: false, suspendedForMs: 90_000 })).toBe(600_000)
  })
})
