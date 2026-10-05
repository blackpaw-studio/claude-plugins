import { describe, expect, test } from 'claude-code/testing'
import { toBreakdown, toUsage } from './usage'

describe('toUsage', () => {
  test('keeps context, limits with epoch resets, and cost', () => {
    const usage = toUsage({
      context: { tokens: 28_000, window: 200_000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 10, resetsAt: '2027-01-15T08:00:00.000Z' },
        { kind: 'seven_day', percentUsed: 75 },
      ],
      cost: { usd: 1.5 },
    })
    expect(usage).toEqual({
      tokens: 28_000,
      window: 200_000,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 10, resetsAt: Date.parse('2027-01-15T08:00:00.000Z') },
        { kind: 'seven_day', percentUsed: 75 },
      ],
      costUsd: 1.5,
    })
  })
  test('an unparseable reset time is dropped', () => {
    const usage = toUsage({ context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 1, resetsAt: 'soon' }] })
    expect(usage.rateLimits).toEqual([{ kind: 'five_hour', percentUsed: 1 }])
    expect(usage.tokens).toBeUndefined()
    expect(usage.costUsd).toBeUndefined()
  })
})

describe('toBreakdown', () => {
  const base = {
    categories: [
      { name: 'System prompt', tokens: 6_400, kind: 'used' as const },
      { name: 'Free space', tokens: 100_000, kind: 'free' as const },
    ],
    rawMaxTokens: 200_000,
    autoCompactThreshold: 170_000,
    isAutoCompactEnabled: true,
  }
  test('folds categories and turns the threshold into a fraction', () => {
    const breakdown = toBreakdown(base)
    expect(breakdown.rawMaxTokens).toBe(200_000)
    expect(breakdown.compactThreshold).toBe(170_000)
    expect(breakdown.categories[0]).toEqual({ key: 'system', tokens: 6_400 })
  })
  test('no marker when auto-compact is off', () => {
    expect(toBreakdown({ ...base, isAutoCompactEnabled: false }).compactThreshold).toBeUndefined()
    expect(toBreakdown({ ...base, autoCompactThreshold: undefined }).compactThreshold).toBeUndefined()
  })
})
