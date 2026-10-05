// Session usage figures to the plain values the state contract holds.
import type { RichStatuslineBreakdown, RichStatuslineRateLimit, RichStatuslineUsage } from '../../types'
import { type BreakdownRow, foldCategories } from '../categories'

export type MeasuredUsage = {
  context: { tokens?: number; window: number }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}

export type MeasuredBreakdown = {
  categories: readonly BreakdownRow[]
  rawMaxTokens: number
  autoCompactThreshold?: number
  isAutoCompactEnabled: boolean
}

const toRateLimit = (limit: MeasuredUsage['rateLimits'][number]): RichStatuslineRateLimit => {
  const resetsAt = limit.resetsAt === undefined ? Number.NaN : Date.parse(limit.resetsAt)
  const base = { kind: limit.kind, percentUsed: limit.percentUsed }
  return Number.isFinite(resetsAt) ? { ...base, resetsAt } : base
}

export const toUsage = (measured: MeasuredUsage): RichStatuslineUsage => ({
  ...(measured.context.tokens === undefined ? {} : { tokens: measured.context.tokens }),
  window: measured.context.window,
  rateLimits: measured.rateLimits.map(toRateLimit),
  ...(measured.cost === undefined ? {} : { costUsd: measured.cost.usd }),
})

const compactFractionOf = (breakdown: MeasuredBreakdown): number | undefined => {
  const { autoCompactThreshold, isAutoCompactEnabled, rawMaxTokens } = breakdown
  if (!isAutoCompactEnabled || autoCompactThreshold === undefined || rawMaxTokens <= 0) return undefined
  return autoCompactThreshold / rawMaxTokens
}

export const toBreakdown = (measured: MeasuredBreakdown): RichStatuslineBreakdown => {
  const compactFraction = compactFractionOf(measured)
  return {
    categories: foldCategories(measured.categories),
    rawMaxTokens: measured.rawMaxTokens,
    ...(compactFraction === undefined ? {} : { compactFraction }),
  }
}
