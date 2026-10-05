// Layout 1c: compact — a full-width bar, then two justified rows.
import { formatCost, formatDurationCompact, shortEffort } from '../format'
import { joinGroups, justify, type Line, mergeRuns, type Span, span, widthOf } from '../line'
import { CATEGORY_COLORS, COLORS } from '../palette'
import type { LimitView, Snapshot } from '../snapshot'
import type { ViewOptions } from '../view-options'
import { categoryBar, contextFigure, diffSpans, limitFigure } from './parts'

const NAMES = { system: 'sys', tools: 'tools', mcp: 'mcp', memory: 'mem', chat: 'chat' } as const
const MIN_GAP = 2

const barRow = (s: Snapshot, o: ViewOptions): Line =>
  categoryBar(s, o.columns, { fill: '▀', empty: '▀', emptyColor: COLORS.empty1c })

const identitySpans = (s: Snapshot, o: ViewOptions): Span[] =>
  mergeRuns([
    span(s.model, COLORS.model, true),
    span(s.effort === undefined ? '  ' : `·${shortEffort(s.effort)}  `, COLORS.muted),
    span(s.cwd, COLORS.system),
    span(`  ${s.branch ?? 'no git'}`, COLORS.dim),
    ...diffSpans(s.diff, o.showDiff),
    ...(o.showPr ? [span(` · ${s.pr ?? 'no PR'}`, COLORS.dim)] : []),
  ])

const categoryNames = (s: Snapshot): Span[] =>
  s.categories === null
    ? []
    : [span('  '), ...joinGroups(s.categories.map(({ key }) => [span(NAMES[key], CATEGORY_COLORS[key])]), [span(' ')])]

const contextRow = (s: Snapshot, o: ViewOptions): Line => {
  const left = identitySpans(s, o)
  const figure = [span('ctx ', COLORS.muted), contextFigure(s, 0)]
  const withNames = [...figure, ...categoryNames(s)]
  const fits = widthOf(left) + MIN_GAP + widthOf(withNames) <= o.columns
  return justify(left, fits ? withNames : figure, o.columns)
}

const limitSpans = (name: string, limit: LimitView | undefined, o: ViewOptions): Span[] =>
  limit === undefined
    ? []
    : [
        span(`${name} `, COLORS.muted),
        limitFigure(limit),
        ...(o.showResets && limit.resetInMs !== undefined
          ? [span(` ↻${formatDurationCompact(limit.resetInMs)}`, COLORS.dim)]
          : []),
      ]

const limitsRow = (s: Snapshot, o: ViewOptions): Line | null => {
  const cost = o.showCost && s.cost !== undefined ? [span(formatCost(s.cost), COLORS.muted)] : []
  const groups = [cost, limitSpans('5h', s.fiveHour, o), limitSpans('wk', s.week, o)]
  if (groups.every(group => group.length === 0)) return null
  return justify([], mergeRuns(joinGroups(groups, [span('   ', COLORS.dim)])), o.columns)
}

export const layout1c = (s: Snapshot, o: ViewOptions): Line[] =>
  [barRow(s, o), contextRow(s, o), limitsRow(s, o)].filter((line): line is Line => line !== null)
