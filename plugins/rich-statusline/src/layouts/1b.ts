// Layout 1b: labeled grid — model, where, context, legend, limits, rule.
import { formatCost, formatDuration, formatTokens } from '../format'
import { type Line, mergeRuns, type Span, span } from '../line'
import { CATEGORY_COLORS, COLORS } from '../palette'
import type { LimitView, Snapshot } from '../snapshot'
import type { ViewOptions } from '../view-options'
import { categoryBar, FILLED_CELL, clamp, contextFigure, diffSpans, limitFigure, resetLabel } from './parts'

const LABEL_WIDTH = 8
const BAR_WIDTH = 60
const MIN_BAR_WIDTH = 10
const CTX_ROW_CHROME = 15
const DOT = '  ·  '
const NAMES = { system: 'sys', tools: 'tools', mcp: 'mcp', memory: 'mem', chat: 'chat' } as const

const label = (text: string): Span => span(text.padEnd(LABEL_WIDTH), COLORS.dim)

const modelRow = (s: Snapshot): Line =>
  mergeRuns([
    label('model'),
    span(s.model, COLORS.model, true),
    ...(s.effort === undefined ? [] : [span(`${DOT}thinking `, COLORS.muted), span(s.effort, COLORS.text)]),
  ])

const whereRow = (s: Snapshot, o: ViewOptions): Line =>
  mergeRuns([
    label('where'),
    span(s.cwd, COLORS.system),
    span(DOT, COLORS.muted),
    span(s.branch ?? 'no git', COLORS.muted),
    ...diffSpans(s.diff, o.showDiff),
    ...(o.showPr ? [span(DOT, COLORS.muted), span(s.pr ?? 'no PR', COLORS.muted)] : []),
  ])

const contextRow = (s: Snapshot, o: ViewOptions): Line => {
  const width = clamp(o.columns - CTX_ROW_CHROME, MIN_BAR_WIDTH, BAR_WIDTH)
  const bar = categoryBar(s, width, { fill: FILLED_CELL, empty: '░', emptyColor: COLORS.empty })
  return [label('context'), ...bar, span('  '), contextFigure(s, 1)]
}

const legendRow = (s: Snapshot, o: ViewOptions): Line | null => {
  if (!o.showLegend || s.categories === null) return null
  const items = s.categories.flatMap(({ key, tokens }) => [
    span(NAMES[key], CATEGORY_COLORS[key]),
    span(` ${formatTokens(tokens)}  `, COLORS.muted),
  ])
  return mergeRuns([span(' '.repeat(LABEL_WIDTH)), ...items, span(`· ${formatTokens(s.freeTokens)} free`, COLORS.faint)])
}

const limitSpans = (name: string, limit: LimitView | undefined, o: ViewOptions): Span[] => {
  if (limit === undefined) return []
  const reset = o.showResets ? resetLabel(limit, formatDuration) : undefined
  return [
    span(`${name} `, COLORS.muted),
    limitFigure(limit),
    ...(reset === undefined ? [] : [span(` resets ${reset}`, COLORS.muted)]),
  ]
}

const costSpans = (s: Snapshot, o: ViewOptions, prefix: string): Span[] =>
  o.showCost && s.cost !== undefined ? [span(`${prefix}${formatCost(s.cost)}`, COLORS.muted)] : []

const limitsRow = (s: Snapshot, o: ViewOptions): Line | null => {
  const session = limitSpans('session', s.fiveHour, o)
  const weekly = limitSpans('weekly', s.week, o)
  if (session.length === 0 && weekly.length === 0) {
    const cost = costSpans(s, o, '')
    return cost.length === 0 ? null : [label('cost'), ...cost]
  }
  const gap = session.length > 0 && weekly.length > 0 ? [span('    ', COLORS.muted)] : []
  return mergeRuns([label('limits'), ...session, ...gap, ...weekly, ...costSpans(s, o, DOT)])
}

const ruleRow = (o: ViewOptions): Line => [span('─'.repeat(o.columns), COLORS.rule)]

export const layout1b = (s: Snapshot, o: ViewOptions): Line[] =>
  [modelRow(s), whereRow(s, o), contextRow(s, o), legendRow(s, o), limitsRow(s, o), ruleRow(o)].filter(
    (line): line is Line => line !== null,
  )
