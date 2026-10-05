import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_SETTINGS } from './settings'
import { bandLayout, cellNeed, rowsOfControls, togglesMenu } from './settings-band'
import { settingsControls } from './settings-controls'

describe('settings band helpers', () => {
  test('controls pair up two to a row, in order', () => {
    const rows = rowsOfControls(settingsControls(DEFAULT_SETTINGS), 2)
    expect(rows.map(row => row.map(control => control.key))).toEqual([
      ['layout', 'showCost'],
      ['showPr', 'showDiff'],
      ['showWorktree', 'showLegend'],
      ['amberPercent', 'redPercent'],
      ['gitRefreshSeconds', 'prRefreshSeconds'],
    ])
    expect(rowsOfControls(settingsControls(DEFAULT_SETTINGS), 1)).toHaveLength(10)
  })
  test('only no argument or `settings` toggles the menu', () => {
    expect(togglesMenu('')).toBe(true)
    expect(togglesMenu(' Settings ')).toBe(true)
    expect(togglesMenu('open')).toBe(false)
  })
  test('a cell needs the longest label, the longest option and the Select chrome', () => {
    // 'Show legend (1a/1b)' 19 + 'Grouped rows' 12 + chrome 4
    expect(cellNeed(settingsControls(DEFAULT_SETTINGS))).toBe(35)
  })
  test('two to a row exactly from twice the cell need', () => {
    const controls = settingsControls(DEFAULT_SETTINGS)
    expect(bandLayout(controls, 70, 12)).toEqual({ perRow: 2, cellWidth: 35, labelWidth: 19, showHint: true })
    expect(bandLayout(controls, 69, 12)).toEqual({ perRow: 1, cellWidth: 69, labelWidth: 19, showHint: true })
  })
  test('over maxRows the hint goes first, then three to a row when the width allows', () => {
    const controls = settingsControls(DEFAULT_SETTINGS)
    // title + hint + 5 rows = 7
    expect(bandLayout(controls, 95, 7)).toMatchObject({ perRow: 2, showHint: true })
    expect(bandLayout(controls, 95, 6)).toMatchObject({ perRow: 2, showHint: false })
    expect(bandLayout(controls, 104, 5)).toMatchObject({ perRow: 2, showHint: false })
    expect(bandLayout(controls, 105, 5)).toEqual({ perRow: 3, cellWidth: 35, labelWidth: 19, showHint: false })
    expect(bandLayout(controls, 105, 12)).toMatchObject({ perRow: 2, showHint: true })
  })
})
