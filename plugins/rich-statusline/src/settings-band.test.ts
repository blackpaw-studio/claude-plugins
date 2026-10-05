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
  test('two to a row exactly from twice the cell need plus the gap between them', () => {
    const controls = settingsControls(DEFAULT_SETTINGS)
    expect(bandLayout(controls, 72, 12)).toEqual({ perRow: 2, cellWidth: 35, gap: 2, labelWidth: 19, showHint: true })
    expect(bandLayout(controls, 71, 12)).toEqual({ perRow: 1, cellWidth: 71, gap: 2, labelWidth: 19, showHint: true })
  })
  test('over maxRows the hint goes first, then three to a row when the width allows', () => {
    const controls = settingsControls(DEFAULT_SETTINGS)
    // title + hint + 5 rows = 7
    expect(bandLayout(controls, 95, 7)).toMatchObject({ perRow: 2, showHint: true })
    expect(bandLayout(controls, 95, 6)).toMatchObject({ perRow: 2, showHint: false })
    // Three cells of 35 and two gaps of 2: 109.
    expect(bandLayout(controls, 108, 5)).toMatchObject({ perRow: 2, showHint: false })
    expect(bandLayout(controls, 109, 5)).toEqual({ perRow: 3, cellWidth: 35, gap: 2, labelWidth: 19, showHint: false })
    expect(bandLayout(controls, 109, 12)).toMatchObject({ perRow: 2, showHint: true })
  })
  test('every row keeps a 2-column gap between cells, each cell fits its control, and no row passes bodyColumns', () => {
    const controls = settingsControls(DEFAULT_SETTINGS)
    const need = cellNeed(controls)
    const failures = [70, 72, 95, 104, 105, 106, 108, 109, 110, 140].flatMap(bodyColumns =>
      [4, 5, 6, 7, 12].flatMap(maxRows => {
        const { perRow, cellWidth, gap } = bandLayout(controls, bodyColumns, maxRows)
        const extent = perRow * cellWidth + (perRow - 1) * gap
        const where = `${bodyColumns}x${maxRows} (${perRow} up)`
        return [
          ...(gap < 2 ? [`${where}: gap ${gap}`] : []),
          ...(extent > bodyColumns ? [`${where}: row ${extent}`] : []),
          ...(perRow > 1 && cellWidth < need ? [`${where}: cell ${cellWidth} < ${need}`] : []),
        ]
      }),
    )
    expect(failures).toEqual([])
  })
})
