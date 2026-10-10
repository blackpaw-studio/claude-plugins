// The snapshot as lines of spans at a width and height: the run view's
// look (glyphs, indents, right-aligned durations) and its fit to the pane. Pure.
import { etaLabel } from './eta'
import { formatDuration, glyphOf, type RowLevel, type RowStatus, truncate, cellsOf } from './format'
import { BLANK, justify, type Line, span, type Span, widthOf } from './line'
import type { Card, Row, Snapshot } from './snapshot'
import { rowsAt, type Window, WINDOWS } from './window'

export type Frame = {
  /** Cells across the pane body. */
  width: number
  /** Rows the pane body holds. */
  rows: number
  /** The spinner's frame: one step per clock tick. */
  frame: number
}

const TITLE = 'GitHub Actions'
const INDENT = '  '
const HEADER_ROWS = 2

const glyphSpan = (status: RowStatus, level: RowLevel, frame: number): Span => {
  const { glyph, ...tone } = glyphOf(status, level, frame)
  return span(glyph, tone)
}

/** A row: indent, glyph, the name cut to fit, the duration (if any) at the right edge. */
const rowLine = (depth: number, glyph: Span, name: (room: number) => Line, right: Line, width: number): Line => {
  const lead = INDENT.repeat(depth)
  const rightCells = right.length === 0 ? 0 : widthOf(right) + 1
  const room = Math.max(1, width - cellsOf(lead) - 2 - rightCells)
  const left: Line = [...(lead === '' ? [] : [span(lead)]), glyph, span(' '), ...name(room)]
  return justify(left, right, width)
}

const durationLine = (ms: number | null, isDim: boolean): Line => {
  const text = formatDuration(ms)
  return text === '' ? [] : [span(text, isDim ? { dim: true } : {})]
}

/** The elapsed time, then ` · ~2m left` when the card has an estimate and the name still fits beside both. */
const cardTimes = (card: Card, width: number): Line => {
  const elapsed = durationLine(card.durationMs, false)
  if (elapsed.length === 0 || card.remainingMs === undefined) return elapsed
  const withEta: Line = [...elapsed, span(` · ${etaLabel(card.remainingMs)}`, { dim: true })]
  return 2 + cellsOf(card.name) + 1 + widthOf(withEta) <= width ? withEta : elapsed
}

/** `CI #482 · push`, the event dropped first when the row is tight; the name opens the run. */
const runName = (card: Card) => (room: number): Line => {
  const event = card.event === '' ? '' : ` · ${card.event}`
  const hasEvent = cellsOf(card.name) + cellsOf(event) <= room
  return [
    span(truncate(card.name, room), { bold: true, opens: card.id }),
    ...(hasEvent && event !== '' ? [span(event, { dim: true })] : []),
  ]
}

/** Steps and summaries read quieter than jobs; the step that is running or failed stands out. */
const isQuiet = (row: Row): boolean => row.isSummary === true || (row.depth === 1 && row.status !== 'running' && row.status !== 'failure')

const jobLine = (row: Row, width: number, frame: number): Line =>
  rowLine(
    row.depth + 1,
    glyphSpan(row.status, row.depth === 0 ? 'job' : 'step', frame),
    room => [span(truncate(row.name, room), isQuiet(row) ? { dim: true } : {})],
    durationLine(row.durationMs, true),
    width,
  )

const cardLines = (card: Card, window: Window, width: number, frame: number): Line[] => [
  rowLine(0, glyphSpan(card.status, 'run', frame), runName(card), cardTimes(card, width), width),
  ...(card.subtitle === '' ? [] : [[span(INDENT), span(truncate(card.subtitle, width - cellsOf(INDENT)), { dim: true })]]),
  ...rowsAt(card.jobs, window).map(row => jobLine(row, width, frame)),
]

const headerLine = ({ label, note }: Snapshot, width: number): Line => {
  const title = label === '' ? TITLE : `${TITLE} · ${label}`
  const right: Line = note === null ? [] : [span(note, note === 'rate limited' ? { color: 'warning' } : { dim: true })]
  const room = Math.max(1, width - (note === null ? 0 : cellsOf(note) + 1))
  return justify([span(truncate(title, room), { dim: true })], right, width)
}

const emptyLine = ({ label }: Snapshot, width: number): Line => [span(truncate(`No workflow runs for ${label}`, width), { dim: true })]

/** Card blocks joined by blank lines. */
const stack = (blocks: readonly Line[][]): Line[] => blocks.flatMap((block, i) => (i === 0 ? block : [BLANK, ...block]))

type Draw = (card: Card, window: Window) => Line[]

const moreLine = (text: string): Line => [span(text, { dim: true })]

/** The card sets to try: all, then less the finished ones, oldest (last) first. */
const keptSets = (cards: readonly Card[]): Card[][] => {
  const finished = cards.filter(card => !card.isActive).reverse()
  return finished.reduce<Card[][]>((sets, drop) => [...sets, (sets[sets.length - 1] ?? []).filter(card => card !== drop)], [[...cards]])
}

const STEP_WINDOWS = WINDOWS.filter(window => window !== 'none')

/** The roomiest window at which these cards stack within `room` rows. */
const fitting = (cards: readonly Card[], draw: Draw, room: number): Line[] | undefined =>
  STEP_WINDOWS.map(window => stack(cards.map(card => draw(card, window)))).find(lines => lines.length <= room)

/**
 * The cards in `room` rows: running steps windowed tighter first, then the
 * oldest finished cards dropped, then running steps hidden; past that, the
 * whole cards that fit and a `+N more` line (rows cut from a lone card).
 */
const fitCards = (cards: readonly Card[], draw: Draw, room: number): Line[] => {
  const sets = keptSets(cards)
  for (const kept of sets) {
    const lines = fitting(kept, draw, room)
    if (lines !== undefined) return lines
  }
  const kept = sets[sets.length - 1] ?? []
  const bare = stack(kept.map(card => draw(card, 'none')))
  if (bare.length <= room) return bare
  const whole = kept.filter((_, n) => stack(kept.slice(0, n + 1).map(card => draw(card, 'none'))).length <= room - 1).length
  if (whole > 0) {
    const lines = fitting(kept.slice(0, whole), draw, room - 1) ?? stack(kept.slice(0, whole).map(card => draw(card, 'none')))
    return [...lines, moreLine(`+${cards.length - whole} more`)]
  }
  const first = kept[0] === undefined ? [] : draw(kept[0], 'none')
  const shown = first.slice(0, Math.max(0, room - 1))
  const hiddenCards = cards.length - 1
  return [...shown, moreLine(hiddenCards > 0 ? `+${hiddenCards} more` : `+${first.length - shown.length} more rows`)]
}

export const layoutPane = (snapshot: Snapshot, { width, rows, frame }: Frame): Line[] => {
  const header = headerLine(snapshot, width)
  if (snapshot.label === '' && snapshot.cards.length === 0) return [header]
  if (snapshot.cards.length === 0) return [header, BLANK, emptyLine(snapshot, width)]
  const draw: Draw = (card, window) => cardLines(card, window, width, frame)
  return [header, BLANK, ...fitCards(snapshot.cards, draw, Math.max(1, rows - HEADER_ROWS))]
}
