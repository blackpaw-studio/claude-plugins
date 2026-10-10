// The snapshot as lines of spans at a width and height: the run view's
// look (glyphs, indents, right-aligned durations) and its overflow rules. Pure.
import { formatDuration, glyphOf, type RowLevel, type RowStatus, truncate, cellsOf } from './format'
import { BLANK, justify, type Line, span, type Span } from './line'
import type { Card, Row, Snapshot } from './snapshot'

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
const rowLine = (depth: number, glyph: Span, name: (room: number) => Line, duration: Span | null, width: number): Line => {
  const lead = INDENT.repeat(depth)
  const durationCells = duration === null ? 0 : cellsOf(duration.text) + 1
  const room = Math.max(1, width - cellsOf(lead) - 2 - durationCells)
  const left: Line = [...(lead === '' ? [] : [span(lead)]), glyph, span(' '), ...name(room)]
  return justify(left, duration === null ? [] : [duration], width)
}

const durationSpan = (ms: number | null, isDim: boolean): Span | null => {
  const text = formatDuration(ms)
  return text === '' ? null : span(text, isDim ? { dim: true } : {})
}

/** `CI #482 · push`, the event dropped first when the row is tight; the name links the run. */
const runName = (card: Card) => (room: number): Line => {
  const event = card.event === '' ? '' : ` · ${card.event}`
  const hasEvent = cellsOf(card.name) + cellsOf(event) <= room
  return [
    span(truncate(card.name, room), { bold: true, href: card.href }),
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
    durationSpan(row.durationMs, true),
    width,
  )

const cardLines = (card: Card, width: number, frame: number): Line[] => [
  rowLine(0, glyphSpan(card.status, 'run', frame), runName(card), durationSpan(card.durationMs, false), width),
  ...(card.subtitle === '' ? [] : [[span(INDENT), span(truncate(card.subtitle, width - cellsOf(INDENT)), { dim: true })]]),
  ...card.rows.map(row => jobLine(row, width, frame)),
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

const heightOf = (blocks: readonly Line[][]): number => stack(blocks).length

/** Drops finished cards, oldest (last) first, until the blocks fit or none is left to drop. */
const dropFinished = (cards: readonly Card[], blocks: readonly Line[][], room: number): number[] => {
  const kept = cards.map((_, i) => i)
  const fits = (indexes: readonly number[]) => heightOf(indexes.map(i => blocks[i] ?? [])) <= room
  const finished = cards.map((card, i) => (card.isActive ? -1 : i)).filter(i => i >= 0).reverse()
  return finished.reduce((left, i) => (fits(left) ? left : left.filter(k => k !== i)), kept)
}

const moreLine = (text: string): Line => [span(text, { dim: true })]

/** The card blocks cut to `room` rows: finished cards dropped first, then a `+N more` line. */
const fitCards = (cards: readonly Card[], blocks: readonly Line[][], room: number): Line[] => {
  const kept = dropFinished(cards, blocks, room)
  const keptBlocks = kept.map(i => blocks[i] ?? [])
  if (heightOf(keptBlocks) <= room) return stack(keptBlocks)
  const lines = stack(keptBlocks).slice(0, Math.max(0, room - 1))
  const whole = keptBlocks.filter((_, n) => heightOf(keptBlocks.slice(0, n + 1)) <= lines.length).length
  const isCutMidCard = whole === 0 || heightOf(keptBlocks.slice(0, whole)) < lines.length
  const hiddenCards = cards.length - whole - (isCutMidCard ? 1 : 0)
  // A trailing blank before the note reads as a gap: trim it.
  const shown = lines[lines.length - 1] === BLANK ? lines.slice(0, -1) : lines
  if (hiddenCards > 0) return [...shown.slice(0, room - 1), moreLine(`+${hiddenCards} more`)]
  return [...shown, moreLine(`+${stack(keptBlocks).length - shown.length} more rows`)]
}

export const layoutPane = (snapshot: Snapshot, { width, rows, frame }: Frame): Line[] => {
  const header = headerLine(snapshot, width)
  if (snapshot.label === '' && snapshot.cards.length === 0) return [header]
  if (snapshot.cards.length === 0) return [header, BLANK, emptyLine(snapshot, width)]
  const blocks = snapshot.cards.map(card => cardLines(card, width, frame))
  return [header, BLANK, ...fitCards(snapshot.cards, blocks, Math.max(1, rows - HEADER_ROWS))]
}
