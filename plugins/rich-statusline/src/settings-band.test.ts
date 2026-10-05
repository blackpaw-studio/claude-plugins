import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_SETTINGS } from './settings'
import { rowsOfControls, togglesMenu } from './settings-band'
import { settingsControls } from './settings-controls'

describe('settings band helpers', () => {
  test('controls pair up two to a row, the odd one last', () => {
    const rows = rowsOfControls(settingsControls(DEFAULT_SETTINGS), 2)
    expect(rows.map(row => row.map(control => control.key))).toEqual([
      ['layout', 'showCost'],
      ['showPr', 'showDiff'],
      ['showLegend', 'amberPercent'],
      ['redPercent', 'gitRefreshSeconds'],
      ['prRefreshSeconds'],
    ])
    expect(rowsOfControls(settingsControls(DEFAULT_SETTINGS), 1)).toHaveLength(9)
  })
  test('only no argument or `settings` toggles the menu', () => {
    expect(togglesMenu('')).toBe(true)
    expect(togglesMenu(' Settings ')).toBe(true)
    expect(togglesMenu('open')).toBe(false)
  })
})
