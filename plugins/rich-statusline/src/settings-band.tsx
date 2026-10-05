// The settings menu, drawn in the band above the prompt (AbovePrompt) while
// /rich-statusline has it open. The band, not a Pane: in some terminals (tmux
// under Leo) a placed Pane is never drawn, while the band always is.
import type { CommandSpec, Elements } from 'claude-code'
import type { Settings } from './settings'
import { type Control, settingsControls } from './settings-controls'

export const COMMAND_NAME = 'rich-statusline'
export const BAND_TITLE = 'rich-statusline settings'
export const BAND_HINT = 'ctrl+x tab to focus · ↑↓/tab move · enter change'
/** From this width the controls sit two to a row. */
const TWO_COLUMN_MIN = 72
const MAX_LABEL_WIDTH = 20
const LABEL_CHROME = 12

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

export const settingsBand = (
  { Box, Text, Select, Button }: BandElements,
  settings: Settings,
  bodyColumns: number,
  handlers: BandHandlers,
) => {
  const perRow = bodyColumns >= TWO_COLUMN_MIN ? 2 : 1
  const cellWidth = Math.floor(bodyColumns / perRow)
  const labelWidth = Math.min(MAX_LABEL_WIDTH, Math.max(0, cellWidth - LABEL_CHROME))
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
      <Text wrap="truncate">
        <Text bold>{BAND_TITLE}</Text>
        <Text dimColor>{`  ${BAND_HINT}`}</Text>
      </Text>
      {rowsOfControls(settingsControls(settings), perRow).map((row, rowIndex) => (
        <Box flexDirection="row">{row.map((control, index) => select(control, rowIndex === 0 && index === 0))}</Box>
      ))}
      <Box flexDirection="row" gap={2}>
        <Button key="done" label="Done" hotkey="d" variant="primary" role="dismiss" onPress={handlers.onDone} />
        <Button key="reset" label="Reset to defaults" hotkey="r" onPress={handlers.onReset} />
      </Box>
    </Box>
  )
}
