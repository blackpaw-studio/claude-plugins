import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_SETTINGS, parseSettings } from './settings'
import { applyPick, settingsControls } from './settings-controls'

describe('settingsControls', () => {
  test('one control per setting, in menu order, showing current values', () => {
    const controls = settingsControls(DEFAULT_SETTINGS)
    expect(controls.map(c => `${c.key}=${c.value}`)).toEqual([
      'layout=1b',
      'showCost=on',
      'showPr=on',
      'showDiff=on',
      'showWorktree=on',
      'showLegend=on',
      'amberPercent=70',
      'redPercent=90',
      'gitRefreshSeconds=10',
      'prRefreshSeconds=60',
    ])
  })
  test('layout options read as plain names over the stored codes', () => {
    const layout = settingsControls(DEFAULT_SETTINGS).find(c => c.key === 'layout')!
    expect(layout.options).toEqual([
      { value: '1a', label: 'Grouped rows' },
      { value: '1b', label: 'Labeled grid' },
      { value: '1c', label: 'Compact' },
    ])
  })
  test('threshold choices never cross each other', () => {
    const controls = settingsControls({ ...DEFAULT_SETTINGS, amberPercent: 80, redPercent: 85 })
    const amber = controls.find(c => c.key === 'amberPercent')!.options.map(o => Number(o.value))
    const red = controls.find(c => c.key === 'redPercent')!.options.map(o => Number(o.value))
    expect(amber.every(v => v < 85)).toBe(true)
    expect(red.every(v => v > 80)).toBe(true)
  })
  test('a stored value outside the presets is still offered', () => {
    const git = settingsControls({ ...DEFAULT_SETTINGS, gitRefreshSeconds: 42 }).find(c => c.key === 'gitRefreshSeconds')!
    expect(git.options.some(o => o.value === '42')).toBe(true)
  })
})

describe('applyPick', () => {
  test('booleans, numbers and layout', () => {
    expect(parseSettings(applyPick(DEFAULT_SETTINGS, 'showCost', 'off')).showCost).toBe(false)
    expect(parseSettings(applyPick(DEFAULT_SETTINGS, 'redPercent', '95')).redPercent).toBe(95)
    expect(parseSettings(applyPick(DEFAULT_SETTINGS, 'layout', '1c')).layout).toBe('1c')
  })
  test('unknown keys and bad values change nothing once parsed', () => {
    expect(parseSettings(applyPick(DEFAULT_SETTINGS, 'nope', 'x'))).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(applyPick(DEFAULT_SETTINGS, 'layout', '9z'))).toEqual(DEFAULT_SETTINGS)
  })
})
