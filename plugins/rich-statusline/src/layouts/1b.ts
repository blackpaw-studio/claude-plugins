// Layout 1b: labeled grid — model, where, context, legend, limits.
import { formatCost, formatDuration, formatTokens } from '../format'
import { firstFitting, fitOrTruncate, type Line, mergeRuns, type Span, span, widthOf } from '../line'
import { CATEGORY_COLORS, COLORS } from '../palette'
import type { LimitView, Snapshot } from '../snapshot'
import type { ViewOptions } from '../view-options'
import {
  categoryBar,
  clamp,
  contextFigure,
  diffSpans,
  FILLED_CELL,
  legendCategories,
  limitFigure,
  resetLabel,
  worktreeSpans,
} from './parts'

const LABEL_WIDTH = 8
const BAR_WIDTH = 60
const MIN_BAR_WIDTH = 10
const FIGURE_GAP = '  '
/** The label column, the gap and the widest figure (`100.0%`) beside the bar. */
const CTX_ROW_CHROME = LABEL_WIDTH + FIGURE_GAP.length + 6
const DOT = '  ·  '
const ITEM_GAP = '  '
const NAMES = { system: 'sys', tools: 'tools', mcp: 'mcp', memory: 'mem', chat: 'chat' } as const

const label = (text: string): Span => span(text.padEnd(LABEL_WIDTH), COLORS.dim)

const modelRow = (s: Snapshot): Line =>
  mergeRuns([
    label('model'),
    span(s.model, COLORS.model, true),
    ...(s.effort === undefined ? [] : [span(`${DOT}thinking `, COLORS.muted), span(s.effort, COLORS.text)]),
  ])

type WhereParts = { isPrShown: boolean; isDiffShown: boolean; isWorktreeShown: boolean }

const whereLine = (s: Snapshot, { isPrShown, isDiffShown, isWorktreeShown }: WhereParts): Line => {
  const worktree = worktreeSpans(s.worktree, isWorktreeShown)
  return mergeRuns([
    label('where'),
    span(s.cwd, COLORS.system),
    ...(worktree.length === 0 ? [] : [span(DOT, COLORS.muted), ...worktree]),
    span(DOT, COLORS.muted),
    span(s.branch ?? 'no git', COLORS.muted),
    ...diffSpans(s.diff, isDiffShown),
    ...(isPrShown ? [span(DOT, COLORS.muted), span(s.pr ?? 'no PR', COLORS.muted)] : []),
  ])
}

/** Drops the PR, then the diff stats, then the worktree, until the row fits; else cuts its end. */
const whereRow = (s: Snapshot, o: ViewOptions): Line => {
  const all = { isPrShown: o.showPr, isDiffShown: o.showDiff, isWorktreeShown: o.showWorktree }
  const noPr = { ...all, isPrShown: false }
  const noDiff = { ...noPr, isDiffShown: false }
  const bare = { ...noDiff, isWorktreeShown: false }
  return fitOrTruncate([all, noPr, noDiff, bare].map(parts => whereLine(s, parts)), o.columns)
}

const contextRow = (s: Snapshot, o: ViewOptions): Line => {
  const width = clamp(o.columns - CTX_ROW_CHROME, MIN_BAR_WIDTH, BAR_WIDTH)
  const bar = categoryBar(s, width, { fill: FILLED_CELL, empty: '░', emptyColor: COLORS.empty, marker: '┊' })
  return [label('context'), ...bar, span(FIGURE_GAP), contextFigure(s, 1)]
}

const legendLine = (s: Snapshot, isCompactShown: boolean): Line => {
  const items = legendCategories(s).flatMap(({ key, tokens }) => [
    span(NAMES[key], CATEGORY_COLORS[key]),
    span(` ${formatTokens(tokens)}${ITEM_GAP}`, COLORS.muted),
  ])
  const compact =
    !isCompactShown || s.compactFraction === undefined
      ? []
      : [span(`${ITEM_GAP}· compact ${Math.round(s.compactFraction * 100)}%`, COLORS.dim)]
  return mergeRuns([
    span(' '.repeat(LABEL_WIDTH)),
    ...items,
    span(`· ${formatTokens(s.freeTokens)} free`, COLORS.faint),
    ...compact,
  ])
}

/** The legend, without its compact note if that is what overflows; else none. */
const legendRow = (s: Snapshot, o: ViewOptions): Line | null => {
  if (!o.showLegend || s.categories === null) return null
  const row = firstFitting([legendLine(s, true), legendLine(s, false)], o.columns)
  return widthOf(row) <= o.columns ? row : null
}

const limitSpans = (name: string, limit: LimitView | undefined, isResetShown: boolean): Span[] => {
  if (limit === undefined) return []
  const reset = isResetShown ? resetLabel(limit, formatDuration) : undefined
  return [
    span(`${name} `, COLORS.muted),
    limitFigure(limit),
    ...(reset === undefined ? [] : [span(` resets ${reset}`, COLORS.muted)]),
  ]
}

const costSpans = (s: Snapshot, isCostShown: boolean, prefix: string): Span[] =>
  isCostShown && s.cost !== undefined ? [span(`${prefix}${formatCost(s.cost)}`, COLORS.muted)] : []

const limitsLine = (s: Snapshot, isResetShown: boolean, isCostShown: boolean): Line => {
  const session = limitSpans('session', s.fiveHour, isResetShown)
  const weekly = limitSpans('weekly', s.week, isResetShown)
  const gap = session.length > 0 && weekly.length > 0 ? [span('    ', COLORS.muted)] : []
  return mergeRuns([label('limits'), ...session, ...gap, ...weekly, ...costSpans(s, isCostShown, DOT)])
}

/** Resets go first, then the cost, when the row would overflow. */
const limitsRow = (s: Snapshot, o: ViewOptions): Line | null => {
  if (s.fiveHour === undefined && s.week === undefined) {
    const cost = costSpans(s, o.showCost, '')
    return cost.length === 0 ? null : [label('cost'), ...cost]
  }
  return firstFitting(
    [limitsLine(s, o.showResets, o.showCost), limitsLine(s, false, o.showCost), limitsLine(s, false, false)],
    o.columns,
  )
}

export const layout1b = (s: Snapshot, o: ViewOptions): Line[] => {
  const legend = legendRow(s, o)
  const limits = limitsRow(s, o)
  return [
    modelRow(s),
    whereRow(s, o),
    contextRow(s, o),
    ...(legend === null ? [] : [legend]),
    ...(limits === null ? [] : [limits]),
  ]
}
