// Usage level for a percentage against the amber and red thresholds.

export type Level = 'ok' | 'amber' | 'red'

export type Thresholds = { amberPercent: number; redPercent: number }

export const levelFor = (percent: number, { amberPercent, redPercent }: Thresholds): Level => {
  if (percent >= redPercent) return 'red'
  if (percent >= amberPercent) return 'amber'
  return 'ok'
}
