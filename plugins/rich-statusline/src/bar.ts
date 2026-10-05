// Pure bar math: category cells, the compact marker, half-cell limit bars.

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

/**
 * Cells per segment: largest remainder over round(tokens / window × width),
 * so the segments sum to the rounded total fill. Earlier segments win ties.
 */
export const allocateCells = (tokens: readonly number[], window: number, width: number): number[] => {
  const safe = tokens.map(value => Math.max(0, value))
  if (window <= 0 || width <= 0) return safe.map(() => 0)
  const scale = width / Math.max(window, sum(safe))
  const exact = safe.map(value => value * scale)
  const floors = exact.map(Math.floor)
  const target = Math.min(width, Math.round(sum(exact)))
  const extra = Math.max(0, target - sum(floors))
  const winners = new Set(
    exact
      .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
      .slice(0, extra)
      .map(entry => entry.index),
  )
  return floors.map((floor, index) => floor + (winners.has(index) ? 1 : 0))
}

/** Where the compact marker sits: round(fraction × width), inside the bar. */
export const markerIndex = (fraction: number, width: number): number =>
  Math.min(width - 1, Math.max(0, Math.round(fraction * width)))

export type HalfBlocks = { full: number; half: number; empty: number }

/** A percentage as whole cells plus at most one half cell. */
export const halfBlocks = (percent: number, width: number): HalfBlocks => {
  const clamped = Math.min(100, Math.max(0, percent))
  const halves = Math.round((clamped / 100) * width * 2)
  const full = Math.floor(halves / 2)
  const half = halves % 2
  return { full, half, empty: width - full - half }
}
