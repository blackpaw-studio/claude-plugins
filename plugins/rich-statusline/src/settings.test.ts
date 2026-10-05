import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_SETTINGS, parseSettings } from './settings'

describe('parseSettings', () => {
  test('nothing stored gives the defaults', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('junk')).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS.layout).toBe('1a')
    expect(DEFAULT_SETTINGS.showDiff).toBe(true)
  })
  test('keeps valid fields', () => {
    const parsed = parseSettings({ layout: '1c', showCost: false, amberPercent: 60, redPercent: 80 })
    expect(parsed).toEqual({ ...DEFAULT_SETTINGS, layout: '1c', showCost: false, amberPercent: 60, redPercent: 80 })
  })
  test('invalid fields fall back one by one', () => {
    const parsed = parseSettings({ layout: '9z', showPr: 'yes', gitRefreshSeconds: 0, prRefreshSeconds: 1.5 })
    expect(parsed).toEqual(DEFAULT_SETTINGS)
  })
  test('thresholds out of order fall back together', () => {
    const parsed = parseSettings({ amberPercent: 95, redPercent: 80 })
    expect(parsed.amberPercent).toBe(DEFAULT_SETTINGS.amberPercent)
    expect(parsed.redPercent).toBe(DEFAULT_SETTINGS.redPercent)
  })
  test('does not mutate its input', () => {
    const raw = Object.freeze({ layout: '1b' })
    expect(parseSettings(raw).layout).toBe('1b')
  })
})
