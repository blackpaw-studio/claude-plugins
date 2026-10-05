// The terminal theme's own palette, so the rows follow the person's theme (light
// or dark): its normal slots 0-7, and no hex anywhere. Gray (bright black, slot 8)
// is the one exception: there is no gray among the normal slots.
//
// Slots go by index as `ansi256(n)`: n < 16 is the theme's own palette entry.
// A name cannot be used: the plugin API refuses `ansi:red` (no `:` allowed), and
// the renderer drops a bare `red` (it is not a theme key).
import type { RichStatuslineCategoryKey } from '../types'
import type { Tone } from './line'
import type { Level } from './thresholds'

const SLOTS = { red: 1, green: 2, yellow: 3, blue: 4, magenta: 5, cyan: 6, gray: 8 } as const

const slot = (name: keyof typeof SLOTS): Tone => ({ color: `ansi256(${SLOTS[name]})` })
const DIM: Tone = { dim: true }

/** Semantic tones. The design's three greys collapse to two tiers: muted (gray) and dim. */
export const COLORS = {
  text: {},
  muted: slot('gray'),
  dim: DIM,
  faint: DIM,
  separator: DIM,
  /** Empty bar cells (every layout) and the bottom rule. */
  empty: { ...slot('gray'), ...DIM },
  system: slot('blue'),
  tools: slot('cyan'),
  mcp: slot('magenta'),
  model: slot('magenta'),
  worktree: slot('magenta'),
  memory: slot('red'),
  chat: slot('green'),
  ok: slot('green'),
  amber: slot('yellow'),
  red: slot('red'),
} as const satisfies Record<string, Tone>

export const CATEGORY_COLORS: Readonly<Record<RichStatuslineCategoryKey, Tone>> = {
  system: COLORS.system,
  tools: COLORS.tools,
  mcp: COLORS.mcp,
  memory: COLORS.memory,
  chat: COLORS.chat,
}

/** A figure's colour: plain text while ok, else the level's. */
export const figureColor = (level: Level): Tone =>
  level === 'red' ? COLORS.red : level === 'amber' ? COLORS.amber : COLORS.text

/** A limit bar's colour: green while ok, else the level's. */
export const barColor = (level: Level): Tone =>
  level === 'red' ? COLORS.red : level === 'amber' ? COLORS.amber : COLORS.ok
