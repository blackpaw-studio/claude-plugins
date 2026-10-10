import { describe, expect, test } from 'claude-code/testing'
import { etaLabel, estimateEta, MIN_SAMPLES } from './eta'
import { MINUTE, SECOND } from './testing/builders'

describe('estimateEta', () => {
  test('is null with fewer than three samples', () => {
    expect(MIN_SAMPLES).toBe(3)
    expect(estimateEta([], 0)).toBe(null)
    expect(estimateEta([60 * SECOND, 70 * SECOND], 0)).toBe(null)
  })

  test('is the median of an odd count, less the elapsed time', () => {
    expect(estimateEta([300 * SECOND, 100 * SECOND, 120 * SECOND], 30 * SECOND)).toBe(90 * SECOND)
  })

  test('is the mean of the middle two for an even count', () => {
    expect(estimateEta([100 * SECOND, 400 * SECOND, 120 * SECOND, 140 * SECOND], 0)).toBe(130 * SECOND)
  })

  test('goes negative once the run is over the estimate', () => {
    expect(estimateEta([60 * SECOND, 60 * SECOND, 60 * SECOND], 90 * SECOND)).toBe(-30 * SECOND)
  })

  test('does not reorder the samples it is given', () => {
    const samples = [3, 1, 2].map(n => n * MINUTE)
    estimateEta(samples, 0)
    expect(samples).toEqual([3 * MINUTE, MINUTE, 2 * MINUTE])
  })
})

describe('etaLabel', () => {
  test('an estimate used up reads over est.', () => {
    expect(etaLabel(0)).toBe('over est.')
    expect(etaLabel(-5 * SECOND)).toBe('over est.')
  })

  test('under a minute reads <1m left', () => {
    expect(etaLabel(SECOND)).toBe('<1m left')
    expect(etaLabel(59 * SECOND)).toBe('<1m left')
  })

  test('a minute and over rounds up to whole minutes', () => {
    expect(etaLabel(60 * SECOND)).toBe('~1m left')
    expect(etaLabel(61 * SECOND)).toBe('~2m left')
    expect(etaLabel(119 * SECOND)).toBe('~2m left')
    expect(etaLabel(59 * MINUTE)).toBe('~59m left')
  })

  test('an hour and over reads in hours and minutes', () => {
    expect(etaLabel(60 * MINUTE)).toBe('~1h 00m left')
    expect(etaLabel(64 * MINUTE)).toBe('~1h 04m left')
    expect(etaLabel(64 * MINUTE + SECOND)).toBe('~1h 05m left')
    expect(etaLabel(59 * MINUTE + 30 * SECOND)).toBe('~1h 00m left')
  })
})
