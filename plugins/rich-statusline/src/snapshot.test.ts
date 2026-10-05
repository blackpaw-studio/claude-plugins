import { describe, expect, test } from 'claude-code/testing'
import { buildSnapshot } from './snapshot'
import { FIXTURE, NOW } from './testing/fixture'

describe('buildSnapshot', () => {
  test('the design fixture', () => {
    const snapshot = buildSnapshot(FIXTURE)
    expect(snapshot.model).toBe('Opus 5.5')
    expect(snapshot.effort).toBe('medium')
    expect(snapshot.cwd).toBe('~/.l/workspace')
    expect(snapshot.branch).toBeNull()
    expect(snapshot.pr).toBeNull()
    expect(snapshot.context).toEqual({ tokens: 28_000, window: 200_000, percent: 14, level: 'ok' })
    expect(snapshot.freeTokens).toBe(172_000)
    expect(snapshot.fiveHour).toEqual({ percent: 10, level: 'ok', resetInMs: 71 * 60_000 + 30_000 })
    expect(snapshot.week?.level).toBe('amber')
    expect(snapshot.cost).toBeUndefined()
  })
  test('a PR read for another branch is not shown', () => {
    const snapshot = buildSnapshot({
      ...FIXTURE,
      git: { branch: 'main', diff: null },
      pr: { label: '#9', branch: 'old' },
    })
    expect(snapshot.pr).toBeNull()
  })
  test('nothing collected yet', () => {
    const snapshot = buildSnapshot({
      ...FIXTURE,
      identity: null,
      git: null,
      pr: null,
      usage: null,
      breakdown: null,
    })
    expect(snapshot.context.tokens).toBeUndefined()
    expect(snapshot.categories).toBeNull()
    expect(snapshot.fiveHour).toBeUndefined()
    expect(snapshot.branch).toBeNull()
  })
  test('red at the red threshold and resets never negative', () => {
    const snapshot = buildSnapshot({
      ...FIXTURE,
      usage: {
        tokens: 190_000,
        window: 200_000,
        rateLimits: [{ kind: 'five_hour', percentUsed: 92, resetsAt: NOW - 5_000 }],
        costUsd: 2,
      },
    })
    expect(snapshot.context.level).toBe('red')
    expect(snapshot.fiveHour).toEqual({ percent: 92, level: 'red', resetInMs: 0 })
    expect(snapshot.cost).toBe(2)
  })
})

test('reset countdowns wait for the first clock reading', () => {
  const snapshot = buildSnapshot({ ...FIXTURE, now: 0 })
  expect(snapshot.fiveHour).toEqual({ percent: 10, level: 'ok' })
})

test('an identity known only from a model step has no path yet', () => {
  const snapshot = buildSnapshot({ ...FIXTURE, identity: { model: 'claude-opus-5-5', cwd: '' } })
  expect(snapshot.cwd).toBe('')
})
