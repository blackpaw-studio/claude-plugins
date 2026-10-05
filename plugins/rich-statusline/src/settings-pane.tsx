// The settings panel: a focused dialog pane of Selects, opened by /rich-statusline.
import type { CommandSpec, Elements, PaneOpenArgs } from 'claude-code'
import type { Settings } from './settings'
import { settingsControls } from './settings-controls'

export const PANE_ID = 'rich-statusline-settings'
export const COMMAND_NAME = 'rich-statusline'
const LABEL_WIDTH = 20

export const COMMAND: CommandSpec = {
  name: COMMAND_NAME,
  description: 'Rich statusline settings: layout, cost, PR, diff stats, legend, thresholds, refresh',
  argumentHint: '[settings]',
  immediate: true,
}

export const PANE: PaneOpenArgs = {
  id: PANE_ID,
  title: 'Rich statusline',
  focus: true,
  closeOnEscape: true,
  holdToasts: true,
  rows: 14,
}

/** True for the arguments that open the panel: none, or `settings`. */
export const opensPanel = (args: string): boolean => ['', 'settings'].includes(args.trim().toLowerCase())

export type PaneHandlers = {
  onPick: (key: string, value: string) => void
  onReset: () => void
  onClose: () => void
}

export type PaneElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Select' | 'Button'>

export const settingsPane = ({ Box, Text, Select, Button }: PaneElements, settings: Settings, handlers: PaneHandlers) => (
  <Box flexDirection="column">
    <Text dimColor>Tab or arrows move · Enter picks · Esc closes · changes apply live</Text>
    {settingsControls(settings).map((control, index) => (
      <Select
        key={control.key}
        label={control.label.padEnd(LABEL_WIDTH)}
        options={control.options}
        value={control.value}
        onSelect={value => handlers.onPick(control.key, value)}
        {...(index === 0 ? { autoFocus: true as const } : {})}
      />
    ))}
    <Box flexDirection="row" gap={2}>
      <Button key="reset" label="Reset to defaults" onPress={handlers.onReset} />
      <Button key="done" label="Done" variant="primary" role="dismiss" onPress={handlers.onClose} />
    </Box>
  </Box>
)
