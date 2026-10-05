// Test helpers over layout lines: the row text and the colour of a span.
import type { Line } from '../line'

export const textOf = (line: Line | undefined): string => (line ?? []).map(span => span.text).join('')

export const rowsOf = (lines: readonly Line[]): string[] => lines.map(textOf)

/** The first span whose text is exactly `text`. */
export const spanOf = (line: Line | undefined, text: string) => (line ?? []).find(span => span.text === text)

/** Colour runs as `text@color` for every coloured span, in order. */
export const runsOf = (line: Line | undefined): string[] =>
  (line ?? []).filter(span => span.color !== undefined).map(span => `${span.text}@${span.color}`)
