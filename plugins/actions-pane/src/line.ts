// A drawing's output: rows of styled spans, independent of any surface.
import { cellsOf } from './format'

export type Span = {
  readonly text: string
  /** A theme colour key; absent is the terminal's foreground. */
  readonly color?: string
  readonly dim?: true
  readonly bold?: true
  /** Drawn as a control that opens this workflow run in the browser. */
  readonly opens?: number
}

export type Line = readonly Span[]

export const span = (text: string, style: Omit<Span, 'text'> = {}): Span => ({ text, ...style })

export const BLANK: Line = [span(' ')]

export const widthOf = (line: Line): number => line.reduce((total, { text }) => total + cellsOf(text), 0)

/** Left spans and right spans pushed to the two ends of `width` cells, at least one space apart; no padding with no right. */
export const justify = (left: Line, right: Line, width: number): Line => {
  if (right.length === 0) return left
  const gap = Math.max(1, width - widthOf(left) - widthOf(right))
  return [...left, ...(gap > 0 ? [span(' '.repeat(gap))] : []), ...right]
}

export const textOf = (line: Line): string => line.map(({ text }) => text).join('')
