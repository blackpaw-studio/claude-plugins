// Collected state to one immutable Snapshot the layouts draw. Pure.
import type {
  RichStatuslineBreakdown,
  RichStatuslineCategory,
  RichStatuslineDiff,
  RichStatuslineGit,
  RichStatuslineIdentity,
  RichStatuslinePr,
  RichStatuslineRateLimit,
  RichStatuslineUsage,
} from '../types'
import { abbreviatePath, displayModel } from './format'
import type { Settings } from './settings'
import { type Level, levelFor, type Thresholds } from './thresholds'

export type SnapshotInputs = {
  identity: RichStatuslineIdentity | null
  git: RichStatuslineGit | null
  pr: RichStatuslinePr | null
  usage: RichStatuslineUsage | null
  breakdown: RichStatuslineBreakdown | null
  settings: Settings
  now: number
}

export type LimitView = { percent: number; level: Level; resetInMs?: number }

export type ContextView = { tokens?: number; window: number; percent?: number; level: Level }

export type Snapshot = {
  model: string
  effort?: string
  cwd: string
  branch: string | null
  diff: RichStatuslineDiff | null
  pr: string | null
  context: ContextView
  /** The five categories, or null before the first breakdown. */
  categories: RichStatuslineCategory[] | null
  barWindow: number
  compactFraction?: number
  freeTokens: number
  fiveHour?: LimitView
  week?: LimitView
  cost?: number
}

const DEFAULT_WINDOW = 200_000
const FALLBACK_MODEL = 'Claude'

const contextView = (usage: RichStatuslineUsage | null, thresholds: Thresholds): ContextView => {
  const window = usage?.window ?? DEFAULT_WINDOW
  const tokens = usage?.tokens
  if (tokens === undefined || window <= 0) return { window, level: 'ok' }
  const percent = (tokens * 100) / window
  return { tokens, window, percent, level: levelFor(percent, thresholds) }
}

const limitView = (
  limits: readonly RichStatuslineRateLimit[],
  kind: string,
  thresholds: Thresholds,
  now: number,
): LimitView | undefined => {
  const limit = limits.find(entry => entry.kind === kind)
  if (limit === undefined) return undefined
  const view = { percent: limit.percentUsed, level: levelFor(limit.percentUsed, thresholds) }
  return limit.resetsAt === undefined ? view : { ...view, resetInMs: Math.max(0, limit.resetsAt - now) }
}

const prFor = (git: RichStatuslineGit | null, pr: RichStatuslinePr | null): string | null =>
  git?.branch != null && pr?.label != null && pr.branch === git.branch ? pr.label : null

const usedTokens = (context: ContextView, categories: RichStatuslineCategory[] | null): number =>
  context.tokens ?? (categories ?? []).reduce((total, category) => total + category.tokens, 0)

export const buildSnapshot = ({ identity, git, pr, usage, breakdown, settings, now }: SnapshotInputs): Snapshot => {
  const context = contextView(usage, settings)
  const categories = breakdown?.categories ?? null
  const limits = usage?.rateLimits ?? []
  const fiveHour = limitView(limits, 'five_hour', settings, now)
  const week = limitView(limits, 'seven_day', settings, now)
  return {
    model: identity === null ? FALLBACK_MODEL : displayModel(identity.model),
    ...(identity?.effort === undefined ? {} : { effort: identity.effort }),
    cwd: identity === null ? '' : abbreviatePath(identity.cwd, identity.home),
    branch: git?.branch ?? null,
    diff: git?.diff ?? null,
    pr: prFor(git, pr),
    context,
    categories,
    barWindow: breakdown?.rawMaxTokens ?? context.window,
    ...(breakdown?.compactFraction === undefined ? {} : { compactFraction: breakdown.compactFraction }),
    freeTokens: Math.max(0, context.window - usedTokens(context, categories)),
    ...(fiveHour === undefined ? {} : { fiveHour }),
    ...(week === undefined ? {} : { week }),
    ...(usage?.costUsd === undefined ? {} : { cost: usage.costUsd }),
  }
}
