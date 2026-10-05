// The settings model: defaults, bounds and a validating parser.
import type { RichStatuslineLayout, RichStatuslineSettings } from '../types'

export type Settings = RichStatuslineSettings

export const LAYOUTS: readonly RichStatuslineLayout[] = ['1a', '1b', '1c']

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  layout: '1a',
  showCost: true,
  showPr: true,
  showDiff: true,
  showLegend: true,
  amberPercent: 70,
  redPercent: 90,
  gitRefreshSeconds: 10,
  prRefreshSeconds: 60,
})

type Range = { min: number; max: number }

export const BOUNDS = {
  amberPercent: { min: 1, max: 99 },
  redPercent: { min: 2, max: 100 },
  gitRefreshSeconds: { min: 2, max: 600 },
  prRefreshSeconds: { min: 10, max: 3600 },
} as const satisfies Record<string, Range>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pickBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

const pickInteger = (value: unknown, { min, max }: Range, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback

const pickLayout = (value: unknown): RichStatuslineLayout =>
  LAYOUTS.find(layout => layout === value) ?? DEFAULT_SETTINGS.layout

const pickThresholds = (raw: Record<string, unknown>): Pick<Settings, 'amberPercent' | 'redPercent'> => {
  const amberPercent = pickInteger(raw.amberPercent, BOUNDS.amberPercent, DEFAULT_SETTINGS.amberPercent)
  const redPercent = pickInteger(raw.redPercent, BOUNDS.redPercent, DEFAULT_SETTINGS.redPercent)
  return amberPercent < redPercent
    ? { amberPercent, redPercent }
    : { amberPercent: DEFAULT_SETTINGS.amberPercent, redPercent: DEFAULT_SETTINGS.redPercent }
}

/** Stored JSON to a valid Settings: each invalid field falls back to its default. */
export const parseSettings = (raw: unknown): Settings => {
  if (!isRecord(raw)) return DEFAULT_SETTINGS
  return {
    layout: pickLayout(raw.layout),
    showCost: pickBoolean(raw.showCost, DEFAULT_SETTINGS.showCost),
    showPr: pickBoolean(raw.showPr, DEFAULT_SETTINGS.showPr),
    showDiff: pickBoolean(raw.showDiff, DEFAULT_SETTINGS.showDiff),
    showLegend: pickBoolean(raw.showLegend, DEFAULT_SETTINGS.showLegend),
    ...pickThresholds(raw),
    gitRefreshSeconds: pickInteger(raw.gitRefreshSeconds, BOUNDS.gitRefreshSeconds, DEFAULT_SETTINGS.gitRefreshSeconds),
    prRefreshSeconds: pickInteger(raw.prRefreshSeconds, BOUNDS.prRefreshSeconds, DEFAULT_SETTINGS.prRefreshSeconds),
  }
}
