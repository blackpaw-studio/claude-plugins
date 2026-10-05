// Layout 1a: grouped rows — identity, context bar, legend, limits.
import { formatCost, formatDuration, formatTokens } from '../format'
import { GAP, joinGroups, type Line, type Span, span } from '../line'
import { CATEGORY_COLORS, COLORS } from '../palette'
import type { LimitView, Snapshot } from '../snapshot'
import type { ViewOptions } from '../view-options'
import { categoryBar, clamp, contextFigure, diffSpans, limitBar, limitFigure } from './parts'

const BAR_WIDTH = 60
const MIN_BAR_WIDTH = 10
const CTX_ROW_CHROME = 21
const LEGEND_INDENT = '     '
const NAMES = { system: 'system', tools: 'tools', mcp: 'mcp', memory: 'memory', chat: 'chat' } as const

const identityRow = (s: Snapshot, o: ViewOptions): Line =>
  joinGroups([
    [span(`◆ ${s.model}`, COLORS.model, true)],
    s.effort === undefined ? [] : [span('thinking ', COLORS.muted), span(s.effort, COLORS.text)],
    [span('│', COLORS.separator)],
    s.cwd === '' ? [] : [span(s.cwd, COLORS.system)],
    [span(s.branch === null ? '⎇ no git' : `⎇ ${s.branch}`, COLORS.muted), ...diffSpans(s.diff, o.showDiff)],
    o.showPr ? [span(s.pr ?? 'no PR', COLORS.muted)] : [],
    o.showCost && s.cost !== undefined ? [span(formatCost(s.cost), COLORS.muted)] : [],
  ])

const contextFigures = (s: Snapshot): Span[] =>
  s.context.tokens === undefined
    ? [contextFigure(s, 1)]
    : [
        contextFigure(s, 1),
        span(' '),
        span(`${formatTokens(s.context.tokens)}/${formatTokens(s.context.window)}`, COLORS.muted),
      ]

const contextRow = (s: Snapshot, o: ViewOptions): Line => {
  const width = clamp(o.columns - CTX_ROW_CHROME, MIN_BAR_WIDTH, BAR_WIDTH)
  const bar = categoryBar(s, width, { fill: '█', empty: '·', emptyColor: COLORS.empty, marker: '┊' })
  return joinGroups([[span('ctx', COLORS.muted)], bar, contextFigures(s)])
}

const legendRow = (s: Snapshot, o: ViewOptions): Line | null => {
  if (!o.showLegend || s.categories === null) return null
  const items = s.categories.map(({ key, tokens }) => [
    span('■', CATEGORY_COLORS[key]),
    span(` ${NAMES[key]} ${formatTokens(tokens)}`, COLORS.muted),
  ])
  const compact =
    s.compactFraction === undefined ? [] : [span(`┊ compact ${Math.round(s.compactFraction * 100)}%`, COLORS.faint)]
  return [span(LEGEND_INDENT), ...joinGroups([...items, compact])]
}

const limitGroup = (label: string, limit: LimitView | undefined, o: ViewOptions): Span[] =>
  limit === undefined
    ? []
    : joinGroups([
        [span(label, COLORS.muted)],
        limitBar(limit),
        [limitFigure(limit)],
        o.showResets && limit.resetInMs !== undefined ? [span(`↻ ${formatDuration(limit.resetInMs)}`, COLORS.muted)] : [],
      ])

const limitsRow = (s: Snapshot, o: ViewOptions): Line | null => {
  if (s.fiveHour === undefined && s.week === undefined) return null
  return joinGroups([limitGroup('5h ', s.fiveHour, o), limitGroup('week', s.week, o)], [
    GAP,
    span('│', COLORS.separator),
    GAP,
  ])
}

export const layout1a = (s: Snapshot, o: ViewOptions): Line[] =>
  [identityRow(s, o), contextRow(s, o), legendRow(s, o), limitsRow(s, o)].filter((line): line is Line => line !== null)
