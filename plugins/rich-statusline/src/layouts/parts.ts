// Pieces the three layouts share: the category bar, limit bars, figures.
import type { RichStatuslineDiff } from '../../types'
import { allocateCells, halfBlocks, markerIndex } from '../bar'
import { type Span, span } from '../line'
import { barColor, CATEGORY_COLORS, COLORS, figureColor } from '../palette'
import type { LimitView, Snapshot } from '../snapshot'

export type BarGlyphs = { fill: string; empty: string; emptyColor: string; marker?: string }

type Segment = { tokens: number; color: string }

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

/** A limit as whole and half cells in its level's colour. */
export const limitBar = (limit: LimitView): Span[] => {
  const { full, half, empty } = halfBlocks(limit.percent, LIMIT_BAR_WIDTH)
  const filled = '█'.repeat(full) + (half === 1 ? '▌' : '')
  return [
    ...(filled === '' ? [] : [span(filled, barColor(limit.level))]),
    ...(empty > 0 ? [span('·'.repeat(empty), COLORS.empty)] : []),
  ]
}

export const limitFigure = (limit: LimitView): Span =>
  span(`${Math.round(limit.percent)}%`, figureColor(limit.level), true)

/** The context percentage with `digits` decimals, or a dash before a reading. */
export const contextFigure = (snapshot: Snapshot, digits: number): Span =>
  snapshot.context.percent === undefined
    ? span('—', COLORS.muted)
    : span(`${snapshot.context.percent.toFixed(digits)}%`, figureColor(snapshot.context.level), true)

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

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
