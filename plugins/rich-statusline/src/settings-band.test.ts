import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_SETTINGS } from './settings'
import { bandLayout, cellNeed, rowsOfControls, togglesMenu } from './settings-band'
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
  test('a cell needs the longest label, the longest option and the Select chrome', () => {
    // 'Show legend (1a/1b)' 19 + '1a grouped rows' 15 + chrome 4
    expect(cellNeed(settingsControls(DEFAULT_SETTINGS))).toBe(38)
  })
  test('two to a row exactly from twice the cell need', () => {
    const controls = settingsControls(DEFAULT_SETTINGS)
    expect(bandLayout(controls, 76, 12)).toEqual({ perRow: 2, cellWidth: 38, labelWidth: 19, showHint: true })
    expect(bandLayout(controls, 75, 12)).toEqual({ perRow: 1, cellWidth: 75, labelWidth: 19, showHint: true })
  })
  test('over maxRows the hint goes first, then three to a row when the width allows', () => {
    const controls = settingsControls(DEFAULT_SETTINGS)
    // title + hint + 5 rows = 7
    expect(bandLayout(controls, 95, 7)).toMatchObject({ perRow: 2, showHint: true })
    expect(bandLayout(controls, 95, 6)).toMatchObject({ perRow: 2, showHint: false })
    expect(bandLayout(controls, 113, 5)).toMatchObject({ perRow: 2, showHint: false })
    expect(bandLayout(controls, 114, 5)).toEqual({ perRow: 3, cellWidth: 38, labelWidth: 19, showHint: false })
    expect(bandLayout(controls, 114, 12)).toMatchObject({ perRow: 2, showHint: true })
  })
})
