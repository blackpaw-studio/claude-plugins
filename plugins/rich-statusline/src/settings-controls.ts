// The settings panel's controls as plain data: one Select per setting. Pure.
import { LAYOUTS, type Settings } from './settings'

export type ControlOption = { value: string; label: string }

export type Control = { key: keyof Settings; label: string; value: string; options: ControlOption[] }

const LAYOUT_LABELS = { '1a': '1a grouped rows', '1b': '1b labeled grid', '1c': '1c compact' } as const

const ON_OFF: ControlOption[] = [
  { value: 'on', label: 'on' },
  { value: 'off', label: 'off' },
]

const numbered = (values: readonly number[], current: number, suffix: string): ControlOption[] =>
  [...new Set([...values, current])].sort((a, b) => a - b).map(value => ({ value: String(value), label: `${value}${suffix}` }))

const AMBER_CHOICES = [50, 60, 65, 70, 75, 80, 85]
const RED_CHOICES = [75, 80, 85, 90, 95, 100]
const GIT_CHOICES = [5, 10, 15, 30, 60]
const PR_CHOICES = [30, 60, 120, 300, 600]

const toggle = (key: keyof Settings, label: string, isOn: boolean): Control => ({
  key,
  label,
  value: isOn ? 'on' : 'off',
  options: ON_OFF,
})

export const settingsControls = (s: Settings): Control[] => [
  {
    key: 'layout',
    label: 'Layout',
    value: s.layout,
    options: LAYOUTS.map(layout => ({ value: layout, label: LAYOUT_LABELS[layout] })),
  },
  toggle('showCost', 'Show cost', s.showCost),
  toggle('showPr', 'Show PR', s.showPr),
  toggle('showDiff', 'Show diff stats', s.showDiff),
  toggle('showLegend', 'Show legend (1a/1b)', s.showLegend),
  {
    key: 'amberPercent',
    label: 'Amber at',
    value: String(s.amberPercent),
    options: numbered(AMBER_CHOICES.filter(v => v < s.redPercent), s.amberPercent, '%'),
  },
  {
    key: 'redPercent',
    label: 'Red at',
    value: String(s.redPercent),
    options: numbered(RED_CHOICES.filter(v => v > s.amberPercent), s.redPercent, '%'),
  },
  { key: 'gitRefreshSeconds', label: 'Git refresh', value: String(s.gitRefreshSeconds), options: numbered(GIT_CHOICES, s.gitRefreshSeconds, 's') },
  { key: 'prRefreshSeconds', label: 'PR refresh', value: String(s.prRefreshSeconds), options: numbered(PR_CHOICES, s.prRefreshSeconds, 's') },
]

const BOOLEAN_KEYS: ReadonlySet<keyof Settings> = new Set(['showCost', 'showPr', 'showDiff', 'showLegend'])
const NUMBER_KEYS: ReadonlySet<keyof Settings> = new Set([
  'amberPercent',
  'redPercent',
  'gitRefreshSeconds',
  'prRefreshSeconds',
])

/** A pick applied to the settings as raw data; parseSettings validates it. */
export const applyPick = (settings: Settings, key: string, value: string): Record<string, unknown> => {
  const field = key as keyof Settings
  if (BOOLEAN_KEYS.has(field)) return { ...settings, [field]: value === 'on' }
  if (NUMBER_KEYS.has(field)) return { ...settings, [field]: Number(value) }
  if (field === 'layout') return { ...settings, layout: value }
  return settings
}
