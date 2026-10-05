// Test helpers over layout lines: the row text and the colour of a span.
import type { Line, Span } from '../line'

export const textOf = (line: Line | undefined): string => (line ?? []).map(span => span.text).join('')

export const rowsOf = (lines: readonly Line[]): string[] => lines.map(textOf)

/** The first span whose text is exactly `text`. */
export const spanOf = (line: Line | undefined, text: string) => (line ?? []).find(span => span.text === text)

/** A span's tone as one string: its named colour or `fg` (the terminal's), `+dim` when dimmed. */
export const toneOf = (span: Span | undefined): string | undefined =>
  span === undefined ? undefined : `${span.color ?? 'fg'}${span.dim === true ? '+dim' : ''}`

/** Runs as `text@tone` for every styled or non-blank span, in order. */
export const runsOf = (line: Line | undefined): string[] =>
  (line ?? [])
    .filter(span => span.color !== undefined || span.dim === true || span.text.trim() !== '')
    .map(span => `${span.text}@${toneOf(span)}`)
