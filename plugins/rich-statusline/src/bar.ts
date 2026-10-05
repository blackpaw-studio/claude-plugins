// Pure bar math: category cells, the compact marker, half-cell limit bars.

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

/** Index of the largest count that can still give up a cell (above one). */
const largestTrimmable = (cells: readonly number[]): number =>
  cells.reduce((best, count, index) => (count > 1 && count > (cells[best] ?? 0) ? index : best), -1)

/** Trims one cell at a time from the largest segment until the bar fits. */
const fitToWidth = (cells: readonly number[], width: number): number[] => {
  const over = sum(cells) - width
  if (over <= 0) return [...cells]
  const index = largestTrimmable(cells)
  if (index < 0) return [...cells]
  return fitToWidth(
    cells.map((count, at) => (at === index ? count - 1 : count)),
    width,
  )
}

/** Indexes of the segments kept when there are more of them than cells: the largest. */
const keptSegments = (tokens: readonly number[], width: number): ReadonlySet<number> =>
  new Set(
    tokens
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => value > 0)
      .sort((a, b) => b.value - a.value || a.index - b.index)
      .slice(0, width)
      .map(({ index }) => index),
  )

/**
 * Cells per segment: round(tokens / window × width) each, at least one for a
 * segment with tokens, trimmed from the largest when the total passes width;
 * with more segments than cells, the smallest get none.
 */
export const allocateCells = (tokens: readonly number[], window: number, width: number): number[] => {
  const safe = tokens.map(value => Math.max(0, value))
  if (window <= 0 || width <= 0) return safe.map(() => 0)
  const kept = keptSegments(safe, width)
  const cells = safe.map((value, index) =>
    kept.has(index) ? Math.max(1, Math.round((value / window) * width)) : 0,
  )
  return fitToWidth(cells, width)
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
