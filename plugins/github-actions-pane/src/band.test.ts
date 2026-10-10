import { describe, expect, test } from 'claude-code/testing'
import type { ActionsData } from '../types'
import { bandAt, bandText } from './band'
import { DEFAULT_SETTINGS } from './settings'
import { buildSnapshot } from './snapshot'
import { dataOf, MINUTE, runOf, SECOND, T0 } from './testing/builders'

const NOW = T0 + 100 * SECOND

const textAt = (data: ActionsData, now = NOW): string | null =>
  bandText(buildSnapshot({ data, now, settings: DEFAULT_SETTINGS, scope: 'branch', isManual: false }))

/** Past successes of workflow 1234 that took `minutes` each. */
const historyOf = (minutes: number) => ({ '1234': [minutes * MINUTE, minutes * MINUTE, minutes * MINUTE] })

const FAILED = { status: 'completed', conclusion: 'failure', updatedAt: T0 + 60 * SECOND } as const

describe('a running band', () => {
  test('counts runs and shows the largest time left among them', () => {
    const data = dataOf({
      runs: [runOf({ id: 1, workflowId: 1234 }), runOf({ id: 2, workflowId: 99, startedAt: T0 + 50 * SECOND, createdAt: T0 + 50 * SECOND })],
      history: { ...historyOf(5), '99': [10 * MINUTE, 10 * MINUTE, 10 * MINUTE] },
    })
    // Run 1: 5m - 1m40s = 3m20s left; run 2: 10m - 50s = 9m10s left.
    expect(textAt(data)).toBe('⟳ 2 running · ~10m left')
  })

  test('says <1m left, then over est. once past the estimate', () => {
    const data = dataOf({ runs: [runOf()], history: historyOf(2) })
    expect(textAt(data, T0 + 90 * SECOND)).toBe('⟳ 1 running · <1m left')
    expect(textAt(data, T0 + 3 * MINUTE)).toBe('⟳ 1 running · over est.')
  })

  test('without an estimate shows the longest elapsed', () => {
    const data = dataOf({
      runs: [runOf({ id: 1 }), runOf({ id: 2, startedAt: T0 + 50 * SECOND, createdAt: T0 + 50 * SECOND })],
    })
    expect(textAt(data)).toBe('⟳ 2 running · 1m 40s')
  })

  test('a queued run counts as running, timed from its creation', () => {
    const data = dataOf({ runs: [runOf({ status: 'queued', startedAt: null })] })
    expect(textAt(data)).toBe('⟳ 1 running · 1m 40s')
  })

  test('a failure alongside a running run does not show', () => {
    const data = dataOf({ runs: [runOf({ id: 1 }), runOf({ id: 2, ...FAILED })], watched: { 2: T0 + 60 * SECOND } })
    expect(textAt(data)).toBe('⟳ 1 running · 1m 40s')
  })
})

describe('a failed band', () => {
  const failed = (id: number, extra: Partial<ReturnType<typeof runOf>> = {}) => runOf({ id, number: id, ...FAILED, ...extra })

  test('names the run that failed, for the linger time', () => {
    const data = dataOf({ runs: [failed(7)], watched: { 7: T0 + 60 * SECOND } })
    expect(textAt(data, T0 + 60 * SECOND + 29 * SECOND)).toBe('✗ CI #7 failed')
    expect(textAt(data, T0 + 60 * SECOND + 30 * SECOND)).toBeNull()
  })

  test('several failures are counted', () => {
    const data = dataOf({ runs: [failed(7), failed(8)], watched: { 7: T0 + 60 * SECOND, 8: T0 + 60 * SECOND } })
    expect(textAt(data, T0 + 70 * SECOND)).toBe('✗ 2 failed')
  })

  test('a new run starting during the linger replaces the failure', () => {
    const data = dataOf({ runs: [failed(7), runOf({ id: 8, startedAt: T0 + 70 * SECOND, createdAt: T0 + 70 * SECOND })], watched: { 7: T0 + 60 * SECOND } })
    expect(textAt(data, T0 + 80 * SECOND)).toBe('⟳ 1 running · 10s')
  })
})

describe('no band', () => {
  test('success lingering, idle, nothing in scope', () => {
    const passed = runOf({ id: 3, status: 'completed', conclusion: 'success', updatedAt: T0 + 60 * SECOND })
    expect(textAt(dataOf({ runs: [passed], watched: { 3: T0 + 60 * SECOND } }), T0 + 70 * SECOND)).toBeNull()
    expect(textAt(dataOf())).toBeNull()
    expect(textAt(dataOf({ context: null }))).toBeNull()
  })

  test('cancelled runs are not failures', () => {
    const cancelled = runOf({ id: 3, status: 'completed', conclusion: 'cancelled', updatedAt: T0 + 60 * SECOND })
    expect(textAt(dataOf({ runs: [cancelled], watched: { 3: T0 + 60 * SECOND } }), T0 + 70 * SECOND)).toBeNull()
  })

  test('rate limited or disabled hides even a running run', () => {
    expect(textAt(dataOf({ runs: [runOf()], isRateLimited: true }))).toBeNull()
    expect(textAt(dataOf({ runs: [runOf()], disabled: 'gh is not installed' }))).toBeNull()
  })
})

describe('bandAt', () => {
  test('ignores the manual "latest run" fallback the pane shows', () => {
    const passed = runOf({ id: 3, status: 'completed', conclusion: 'failure', updatedAt: T0 })
    const inputs = { data: dataOf({ runs: [passed] }), now: NOW, settings: DEFAULT_SETTINGS, scope: 'branch' } as const
    expect(bandAt(inputs)).toBeNull()
  })
})
