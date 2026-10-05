// A layout's output: rows of styled spans, independent of any surface.

/** How a span is tinted: a named terminal colour (absent: the default fg), dimmed or not. */
export type Tone = { readonly color?: string; readonly dim?: true }

export type Span = { readonly text: string; readonly color?: string; readonly dim?: true; readonly bold?: boolean }

export type Line = readonly Span[]

export const span = (text: string, tone: Tone = {}, bold?: boolean): Span => ({
  text,
  ...(tone.color === undefined ? {} : { color: tone.color }),
  ...(tone.dim === true ? { dim: true as const } : {}),
  ...(bold === true ? { bold } : {}),
})

export const GAP: Span = span('  ')

/** An empty row (padding); one space so the row keeps its height. */
export const BLANK_LINE: Line = [span(' ')]

export const widthOf = (spans: readonly Span[]): number =>
  spans.reduce((total, { text }) => total + [...text].length, 0)

/** Groups of spans joined by a separator, empty groups dropped. */
export const joinGroups = (groups: readonly (readonly Span[])[], separator: readonly Span[] = [GAP]): Span[] =>
  groups
    .filter(group => group.length > 0)
    .flatMap((group, index) => (index === 0 ? [...group] : [...separator, ...group]))

/** Left and right spans pushed to the row's two ends across `width` cells. */
export const justify = (left: readonly Span[], right: readonly Span[], width: number): Span[] => {
  const pad = Math.max(left.length > 0 && right.length > 0 ? 2 : 0, width - widthOf(left) - widthOf(right))
  return [...left, ...(pad > 0 ? [span(' '.repeat(pad))] : []), ...right]
}

/** Neighbouring spans of one style merged, empty spans dropped. */
export const mergeRuns = (spans: readonly Span[]): Span[] =>
  spans.reduce<Span[]>((merged, next) => {
    if (next.text === '') return merged
    const last = merged[merged.length - 1]
    return last !== undefined && last.color === next.color && last.dim === next.dim && last.bold === next.bold
      ? [...merged.slice(0, -1), { ...last, text: last.text + next.text }]
      : [...merged, next]
  }, [])

/** The first candidate that fits `width` cells, else the last (the leanest). */
export const firstFitting = (candidates: readonly Line[], width: number): Line =>
  candidates.find(line => widthOf(line) <= width) ?? candidates[candidates.length - 1] ?? []

const ELLIPSIS = '…'

/** The line cut to `width` cells, its last cell an ellipsis; as is when it fits. */
export const truncateLine = (line: Line, width: number): Line => {
  if (widthOf(line) <= width) return line
  if (width < 1) return []
  const { kept } = line.reduce<{ kept: Span[]; room: number }>(
    ({ kept, room }, next) => {
      if (room <= 0) return { kept, room }
      const cells = [...next.text]
      if (cells.length < room) return { kept: [...kept, next], room: room - cells.length }
      return { kept: [...kept, { ...next, text: cells.slice(0, room - 1).join('') + ELLIPSIS }], room: 0 }
    },
    { kept: [], room: width },
  )
  return kept
}

/** firstFitting, the leanest candidate cut to `width` when none fits. */
export const fitOrTruncate = (candidates: readonly Line[], width: number): Line =>
  truncateLine(firstFitting(candidates, width), width)
