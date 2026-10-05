// Layout 1c: compact — a full-width bar, then two justified rows.
import { formatCost, formatDurationCompact, shortEffort } from '../format'
import { fitOrTruncate, joinGroups, justify, type Line, mergeRuns, type Span, span, widthOf } from '../line'
import { CATEGORY_COLORS, COLORS } from '../palette'
import type { LimitView, Snapshot } from '../snapshot'
import type { ViewOptions } from '../view-options'
import {
  categoryBar,
  contextFigure,
  diffSpans,
  legendCategories,
  limitFigure,
  resetLabel,
  worktreeSpans,
} from './parts'

const NAMES = { system: 'sys', tools: 'tools', mcp: 'mcp', memory: 'mem', chat: 'chat' } as const
const MIN_GAP = 2

const barRow = (s: Snapshot, o: ViewOptions): Line =>
  categoryBar(s, o.columns, { fill: '▀', empty: '▀', emptyColor: COLORS.empty1c })

type IdentityParts = { isPrShown: boolean; isDiffShown: boolean; isWorktreeShown: boolean }

const identitySpans = (s: Snapshot, { isPrShown, isDiffShown, isWorktreeShown }: IdentityParts): Span[] =>
  mergeRuns([
    span(s.model, COLORS.model, true),
    span(`${s.effort === undefined ? '' : `·${shortEffort(s.effort)}`}${s.cwd === '' ? '' : '  '}`, COLORS.muted),
    span(s.cwd, COLORS.system),
    ...(s.worktree === null || !isWorktreeShown
      ? [span(`  ${s.branch ?? 'no git'}`, COLORS.dim)]
      : [span('  '), ...worktreeSpans(s.worktree, true), span(` ${s.branch ?? 'no git'}`, COLORS.dim)]),
    ...diffSpans(s.diff, isDiffShown),
    ...(isPrShown ? [span(` · ${s.pr ?? 'no PR'}`, COLORS.dim)] : []),
  ])

/** Drops the PR, then the diff stats, then the worktree, until `width` holds it; else cuts its end. */
const identityFitting = (s: Snapshot, o: ViewOptions, width: number): Line => {
  const all = { isPrShown: o.showPr, isDiffShown: o.showDiff, isWorktreeShown: o.showWorktree }
  const noPr = { ...all, isPrShown: false }
  const noDiff = { ...noPr, isDiffShown: false }
  const bare = { ...noDiff, isWorktreeShown: false }
  return fitOrTruncate([all, noPr, noDiff, bare].map(parts => identitySpans(s, parts)), width)
}

const categoryNames = (s: Snapshot): Span[] =>
  s.categories === null
    ? []
    : [span('  '), ...joinGroups(legendCategories(s).map(({ key }) => [span(NAMES[key], CATEGORY_COLORS[key])]), [span(' ')])]

const contextRow = (s: Snapshot, o: ViewOptions): Line => {
  const figure = [span('ctx ', COLORS.muted), contextFigure(s, 0)]
  const left = identityFitting(s, o, o.columns - MIN_GAP - widthOf(figure))
  const withNames = [...figure, ...categoryNames(s)]
  const fits = widthOf(left) + MIN_GAP + widthOf(withNames) <= o.columns
  return justify(left, fits ? withNames : figure, o.columns)
}

const limitSpans = (name: string, limit: LimitView | undefined, o: ViewOptions): Span[] => {
  if (limit === undefined) return []
  const reset = o.showResets ? resetLabel(limit, formatDurationCompact) : undefined
  return [
    span(`${name} `, COLORS.muted),
    limitFigure(limit),
    ...(reset === undefined ? [] : [span(` ↻${reset}`, COLORS.dim)]),
  ]
}

const limitsRow = (s: Snapshot, o: ViewOptions): Line | null => {
  const cost = o.showCost && s.cost !== undefined ? [span(formatCost(s.cost), COLORS.muted)] : []
  const groups = [cost, limitSpans('5h', s.fiveHour, o), limitSpans('wk', s.week, o)]
  if (groups.every(group => group.length === 0)) return null
  return justify([], mergeRuns(joinGroups(groups, [span('   ', COLORS.dim)])), o.columns)
}

export const layout1c = (s: Snapshot, o: ViewOptions): Line[] =>
  [barRow(s, o), contextRow(s, o), limitsRow(s, o)].filter((line): line is Line => line !== null)
