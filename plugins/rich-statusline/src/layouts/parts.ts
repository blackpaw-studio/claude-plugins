// Pieces the three layouts share: the category bar, limit bars, figures.
import type { RichStatuslineDiff } from '../../types'
import { allocateCells, markerIndex, wholeCells } from '../bar'
import { type Line, type Span, span, type Tone } from '../line'
import { barColor, CATEGORY_COLORS, COLORS, figureColor } from '../palette'
import type { LimitView, Snapshot } from '../snapshot'
import { levelFor } from '../thresholds'

export type BarGlyphs = { fill: string; empty: string; emptyColor: Tone; marker?: string }

type Segment = { tokens: number; color: Tone }

const segmentsOf = (snapshot: Snapshot): Segment[] => {
  if (snapshot.categories !== null) {
    return snapshot.categories.map(({ key, tokens }) => ({ tokens, color: CATEGORY_COLORS[key] }))
  }
  return snapshot.context.tokens === undefined ? [] : [{ tokens: snapshot.context.tokens, color: COLORS.muted }]
}

const emptyRun = (from: number, to: number, glyphs: BarGlyphs): Span[] =>
  to > from ? [span(glyphs.empty.repeat(to - from), glyphs.emptyColor)] : []

const emptySpans = (filled: number, width: number, glyphs: BarGlyphs, marker: number | undefined): Span[] =>
  marker === undefined || marker < filled || glyphs.marker === undefined
    ? emptyRun(filled, width, glyphs)
    : [...emptyRun(filled, marker, glyphs), span(glyphs.marker, COLORS.muted), ...emptyRun(marker + 1, width, glyphs)]

/** The context bar: category cells, then empty cells with the compact marker. */
export const categoryBar = (snapshot: Snapshot, width: number, glyphs: BarGlyphs): Span[] => {
  const segments = snapshot.context.tokens === undefined ? [] : segmentsOf(snapshot)
  const cells = allocateCells(
    segments.map(segment => segment.tokens),
    snapshot.barWindow,
    width,
  )
  const filled = cells.reduce((total, count) => total + count, 0)
  const marker = snapshot.compactFraction === undefined ? undefined : markerIndex(snapshot.compactFraction, width)
  const filledSpans = segments.flatMap((segment, index) => {
    const count = cells[index] ?? 0
    return count > 0 ? [span(glyphs.fill.repeat(count), segment.color)] : []
  })
  return [...filledSpans, ...emptySpans(filled, width, glyphs, marker)]
}

export const LIMIT_BAR_WIDTH = 10
/** Filled cell of the 1a/1b bars: ¾ height leaves a gap between rows (approved deviation). */
export const FILLED_CELL = '▆'

/** A limit as whole cells in its level's colour. */
export const limitBar = (limit: LimitView): Span[] => {
  const { full, empty } = wholeCells(limit.percent, LIMIT_BAR_WIDTH)
  const filled = FILLED_CELL.repeat(full)
  return [
    ...(filled === '' ? [] : [span(filled, barColor(limit.level))]),
    ...(empty > 0 ? [span('·'.repeat(empty), COLORS.empty)] : []),
  ]
}

/** A limit's whole percentage; dim once its window has passed unread. */
export const limitFigure = (limit: LimitView): Span =>
  limit.isStale === true
    ? span(`${Math.round(limit.percent)}%`, COLORS.dim)
    : span(`${Math.round(limit.percent)}%`, figureColor(limit.level), true)

/** When the limit resets, `now` once passed; undefined when unknown. */
export const resetLabel = (limit: LimitView, format: (ms: number) => string): string | undefined =>
  limit.isStale === true ? 'now' : limit.resetInMs === undefined ? undefined : format(limit.resetInMs)

/**
 * The context percentage with `digits` decimals, or a dash before a reading;
 * coloured by the value as shown, so `70.0%` is never drawn as under 70.
 */
export const contextFigure = (snapshot: Snapshot, digits: number): Span => {
  const { percent } = snapshot.context
  if (percent === undefined) return span('—', COLORS.muted)
  const shown = percent.toFixed(digits)
  return span(`${shown}%`, figureColor(levelFor(Number(shown), snapshot.thresholds)), true)
}

/** `wt <name>` before the branch in a linked worktree; nothing otherwise or hidden. */
export const worktreeSpans = (worktree: string | null, isShown: boolean): Span[] =>
  worktree === null || !isShown ? [] : [span('wt ', COLORS.muted), span(worktree, COLORS.worktree)]

/** ` (+12,-3)` after the branch; nothing when clean or hidden. */
export const diffSpans = (diff: RichStatuslineDiff | null, isShown: boolean): Span[] =>
  diff === null || !isShown
    ? []
    : [
        span(' (', COLORS.muted),
        span(`+${diff.insertions}`, COLORS.ok),
        span(',', COLORS.muted),
        span(`-${diff.deletions}`, COLORS.red),
        span(')', COLORS.muted),
      ]

/** The block's last row in every layout: a full-width rule. */
export const ruleRow = (columns: number): Line => [span('─'.repeat(Math.max(0, columns)), COLORS.rule)]

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
