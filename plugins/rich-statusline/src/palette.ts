// The design's colours (hex from its oklch values) and per-category tints.
import type { RichStatuslineCategoryKey } from '../types'
import type { Level } from './thresholds'

export const COLORS = {
  text: '#e3e5e8',
  muted: '#7d8086',
  dim: '#606369',
  faint: '#52555b',
  separator: '#3f4348',
  empty: '#303338',
  empty1c: '#2b2e33',
  rule: '#24272a',
  system: '#82baff',
  tools: '#3bcfcf',
  mcp: '#c3a5f9',
  model: '#c3a5f9',
  memory: '#ee97c9',
  chat: '#8dca80',
  ok: '#8dca80',
  amber: '#f3ae58',
  red: '#f97770',
} as const

export const CATEGORY_COLORS: Readonly<Record<RichStatuslineCategoryKey, string>> = {
  system: COLORS.system,
  tools: COLORS.tools,
  mcp: COLORS.mcp,
  memory: COLORS.memory,
  chat: COLORS.chat,
}

/** A figure's colour: plain text while ok, else the level's. */
export const figureColor = (level: Level): string =>
  level === 'red' ? COLORS.red : level === 'amber' ? COLORS.amber : COLORS.text

/** A limit bar's colour: green while ok, else the level's. */
export const barColor = (level: Level): string =>
  level === 'red' ? COLORS.red : level === 'amber' ? COLORS.amber : COLORS.ok
