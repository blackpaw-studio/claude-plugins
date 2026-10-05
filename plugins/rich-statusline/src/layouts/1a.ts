// Layout 1a: grouped rows — identity, context bar, legend, limits.
import { formatCost, formatDuration, formatTokens } from '../format'
import { firstFitting, fitOrTruncate, GAP, joinGroups, type Line, type Span, span } from '../line'
import { CATEGORY_COLORS, COLORS } from '../palette'
import type { LimitView, Snapshot } from '../snapshot'
import type { ViewOptions } from '../view-options'
import {
  categoryBar,
  clamp,
  compactNote,
  contextFigure,
  diffSpans,
  FILLED_CELL,
  legendCategories,
  legendRow,
  limitBar,
  limitFigure,
  resetLabel,
  worktreeSpans,
} from './parts'

const BAR_WIDTH = 60
const MIN_BAR_WIDTH = 10
/** `ctx`, two gaps and the widest figures (`100.0% 200k/200k`) around the bar. */
const CTX_ROW_CHROME = 3 + 2 + 2 + 16
const LABEL_GAP = '  '
const LEGEND_INDENT = ' '.repeat(3 + LABEL_GAP.length)
const NAMES = { system: 'system', tools: 'tools', mcp: 'mcp', memory: 'memory', chat: 'chat' } as const

const join = (groups: readonly (readonly Span[])[]): Span[] => joinGroups(groups, [GAP])

type IdentityParts = { isCostShown: boolean; isPrShown: boolean; isDiffShown: boolean; isWorktreeShown: boolean }

const identityLine = (s: Snapshot, { isCostShown, isPrShown, isDiffShown, isWorktreeShown }: IdentityParts): Line =>
  join([
    [span(`◆ ${s.model}`, COLORS.model, true)],
    s.effort === undefined ? [] : [span('thinking ', COLORS.muted), span(s.effort, COLORS.text)],
    [span('│', COLORS.separator)],
    s.cwd === '' ? [] : [span(s.cwd, COLORS.system)],
    worktreeSpans(s.worktree, isWorktreeShown),
    [span(s.branch === null ? '⎇ no git' : `⎇ ${s.branch}`, COLORS.muted), ...diffSpans(s.diff, isDiffShown)],
    isPrShown ? [span(s.pr ?? 'no PR', COLORS.muted)] : [],
    isCostShown && s.cost !== undefined ? [span(formatCost(s.cost), COLORS.muted)] : [],
  ])

/** Drops cost, then PR, then diff stats, then the worktree until the row fits; else cuts its end. */
const identityRow = (s: Snapshot, o: ViewOptions): Line => {
  const all = { isCostShown: o.showCost, isPrShown: o.showPr, isDiffShown: o.showDiff, isWorktreeShown: o.showWorktree }
  const noCost = { ...all, isCostShown: false }
  const noPr = { ...noCost, isPrShown: false }
  const noDiff = { ...noPr, isDiffShown: false }
  const bare = { ...noDiff, isWorktreeShown: false }
  return fitOrTruncate([all, noCost, noPr, noDiff, bare].map(parts => identityLine(s, parts)), o.columns)
}

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
  const bar = categoryBar(s, width, { fill: FILLED_CELL, empty: '·', emptyColor: COLORS.empty, marker: '┊' })
  return join([[span('ctx', COLORS.muted)], bar, contextFigures(s)])
}

const legendLine = (s: Snapshot, isCompactShown: boolean): Line => {
  const items = legendCategories(s).map(({ key, tokens }) => [
    span('■', CATEGORY_COLORS[key]),
    span(` ${NAMES[key]} ${formatTokens(tokens)}`, COLORS.muted),
  ])
  const note = isCompactShown ? compactNote(s) : undefined
  const compact = note === undefined ? [] : [span(`┊ ${note}`, COLORS.faint)]
  return [span(LEGEND_INDENT), ...join([...items, compact])]
}

const limitGroup = (label: string, limit: LimitView | undefined, isResetShown: boolean): Span[] => {
  if (limit === undefined) return []
  const reset = isResetShown ? resetLabel(limit, formatDuration) : undefined
  return join([
    [span(label, COLORS.muted)],
    limitBar(limit),
    [limitFigure(limit)],
    reset === undefined ? [] : [span(`↻ ${reset}`, COLORS.muted)],
  ])
}

const limitsLine = (s: Snapshot, isResetShown: boolean): Line =>
  joinGroups([limitGroup('5h ', s.fiveHour, isResetShown), limitGroup('week', s.week, isResetShown)], [
    GAP,
    span('│', COLORS.separator),
    GAP,
  ])

/** Reset countdowns go first when the row would overflow. */
const limitsRow = (s: Snapshot, o: ViewOptions): Line | null => {
  if (s.fiveHour === undefined && s.week === undefined) return null
  return firstFitting([limitsLine(s, o.showResets), limitsLine(s, false)], o.columns)
}

export const layout1a = (s: Snapshot, o: ViewOptions): Line[] => {
  const legend = legendRow(s, o, legendLine)
  const limits = limitsRow(s, o)
  return [
    identityRow(s, o),
    contextRow(s, o),
    ...(legend === null ? [] : [legend]),
    ...(limits === null ? [] : [limits]),
  ]
}
