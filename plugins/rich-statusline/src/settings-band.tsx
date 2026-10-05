// The settings menu, drawn in the band above the prompt (AbovePrompt) while
// /rich-statusline has it open. The band, not a Pane: in some terminals (tmux
// under Leo) a placed Pane is never drawn, while the band always is.
import type { CommandSpec, Elements } from 'claude-code'
import type { Settings } from './settings'
import { type Control, settingsControls } from './settings-controls'

export const COMMAND_NAME = 'rich-statusline'
export const BAND_TITLE = 'rich-statusline settings'
export const BAND_HINT = 'ctrl+x tab to focus · ↑↓/tab move · enter change'
/** What a Select draws around its label and value; the types do not say. */
const SELECT_CHROME = 4
/** Rows besides the controls: the title row (with Done and Reset), the hint. */
const TITLE_ROWS = 1
const HINT_ROWS = 1
const PREFERRED_PER_ROW = 2
const MOST_PER_ROW = 3
/** Columns between two cells of a row: a Select draws to its cell's edge, so cells need it to stay apart. */
const CELL_GAP = 2

export const COMMAND: CommandSpec = {
  name: COMMAND_NAME,
  description: 'Rich statusline settings: layout, cost, PR, diff stats, legend, thresholds, refresh',
  argumentHint: '[settings]',
  immediate: true,
}

/** True for the arguments that toggle the menu: none, or `settings`. */
export const togglesMenu = (args: string): boolean => ['', 'settings'].includes(args.trim().toLowerCase())

export type BandHandlers = {
  onPick: (key: string, value: string) => void
  onReset: () => void
  onDone: () => void
}

export type BandElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Select' | 'Button'>

/** Controls in rows of `perRow`, in order. Pure. */
export const rowsOfControls = (controls: readonly Control[], perRow: number): Control[][] =>
  controls.reduce<Control[][]>(
    (rows, control, index) =>
      index % perRow === 0 ? [...rows, [control]] : [...rows.slice(0, -1), [...(rows[rows.length - 1] ?? []), control]],
    [],
  )

const cellsOf = (text: string): number => [...text].length
const longest = (texts: readonly string[]): number => Math.max(0, ...texts.map(cellsOf))

/** Cells one control needs unwrapped: longest label + longest option + chrome. */
export const cellNeed = (controls: readonly Control[]): number =>
  longest(controls.map(control => control.label)) +
  longest(controls.flatMap(control => control.options.map(option => option.label))) +
  SELECT_CHROME

export type BandLayout = { perRow: number; cellWidth: number; gap: number; labelWidth: number; showHint: boolean }

/** Cells of `need` that fit `bodyColumns` with `CELL_GAP` between each two. Pure. */
const cellsFitting = (bodyColumns: number, need: number): number => Math.floor((bodyColumns + CELL_GAP) / (need + CELL_GAP))

/**
 * How the band fits `bodyColumns` × `maxRows`: two controls to a row when no
 * cell would wrap and `CELL_GAP` still parts them; over `maxRows`, drop the
 * hint first, then three to a row when the width allows. Pure.
 */
export const bandLayout = (controls: readonly Control[], bodyColumns: number, maxRows: number): BandLayout => {
  const need = cellNeed(controls)
  const widest = Math.max(1, Math.min(MOST_PER_ROW, cellsFitting(bodyColumns, need)))
  const rowsAt = (perRow: number, showHint: boolean) =>
    TITLE_ROWS + (showHint ? HINT_ROWS : 0) + Math.ceil(controls.length / perRow)
  const preferred = Math.min(PREFERRED_PER_ROW, widest)
  const showHint = rowsAt(preferred, true) <= maxRows
  const perRow = showHint || rowsAt(preferred, false) <= maxRows ? preferred : widest
  return {
    perRow,
    cellWidth: Math.floor((bodyColumns - CELL_GAP * (perRow - 1)) / perRow),
    gap: CELL_GAP,
    labelWidth: longest(controls.map(control => control.label)),
    showHint,
  }
}

export const settingsBand = (
  { Box, Text, Select, Button }: BandElements,
  settings: Settings,
  { bodyColumns, maxRows }: { bodyColumns: number; maxRows: number },
  handlers: BandHandlers,
) => {
  const controls = settingsControls(settings)
  const { perRow, cellWidth, gap, labelWidth, showHint } = bandLayout(controls, bodyColumns, maxRows)
  const select = (control: Control, isFirst: boolean) => (
    <Box width={cellWidth}>
      <Select
        key={control.key}
        label={control.label.padEnd(labelWidth)}
        options={control.options}
        value={control.value}
        onSelect={value => handlers.onPick(control.key, value)}
        {...(isFirst ? { autoFocus: true as const } : {})}
      />
    </Box>
  )
  return (
    <Box flexDirection="column" width={bodyColumns}>
      <Box flexDirection="row" gap={2}>
        <Text bold wrap="truncate">
          {BAND_TITLE}
        </Text>
        <Button key="done" label="Done" hotkey="d" variant="primary" role="dismiss" onPress={handlers.onDone} />
        <Button key="reset" label="Reset to defaults" hotkey="r" onPress={handlers.onReset} />
      </Box>
      {showHint ? (
        <Text dimColor wrap="truncate">
          {BAND_HINT}
        </Text>
      ) : null}
      {rowsOfControls(controls, perRow).map((row, rowIndex) => (
        <Box flexDirection="row" gap={gap}>
          {row.map((control, index) => select(control, rowIndex === 0 && index === 0))}
        </Box>
      ))}
    </Box>
  )
}
