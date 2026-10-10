// Durations, truncation and the status glyphs the pane draws. Pure.

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const ELLIPSIS = '…'

/** What a row's status draws as, folded from GitHub's status and conclusion. */
export type RowStatus = 'success' | 'failure' | 'running' | 'queued' | 'cancelled' | 'action'

/** Which level a row sits at: the run and its jobs spin as ◐, a step as the spinner. */
export type RowLevel = 'run' | 'job' | 'step'

/** A glyph and its tint: a theme colour key, or dimmed. */
export type Glyph = { glyph: string; color?: string; dim?: true }

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `0s`, `42s`, `1m 04s`, `1h 04m`; null is no duration (''), negative skew is 0s. */
export const formatDuration = (ms: number | null): string => {
  if (ms === null) return ''
  const clamped = Math.max(0, ms)
  if (clamped < MINUTE) return `${Math.floor(clamped / SECOND)}s`
  if (clamped < HOUR) return `${Math.floor(clamped / MINUTE)}m ${pad2(Math.floor((clamped % MINUTE) / SECOND))}s`
  return `${Math.floor(clamped / HOUR)}h ${pad2(Math.floor((clamped % HOUR) / MINUTE))}m`
}

/** Cells a text takes: one per code point (the pane draws no wide glyphs in names). */
export const cellsOf = (text: string): number => [...text].length

/** The text cut to `width` cells, its last an ellipsis; as is when it fits. */
export const truncate = (text: string, width: number): string => {
  const cells = [...text]
  if (cells.length <= width) return text
  if (width <= 0) return ''
  return cells.slice(0, width - 1).join('') + ELLIPSIS
}

const FAILED = new Set(['failure', 'timed_out', 'startup_failure'])
const QUIET = new Set(['cancelled', 'skipped', 'neutral', 'stale'])

export const statusOf = (status: string, conclusion: string | null): RowStatus => {
  if (status === 'in_progress') return 'running'
  if (status !== 'completed') return 'queued'
  if (conclusion === 'success') return 'success'
  if (conclusion !== null && FAILED.has(conclusion)) return 'failure'
  if (conclusion === 'action_required') return 'action'
  if (conclusion !== null && QUIET.has(conclusion)) return 'cancelled'
  return 'queued'
}

export const isActiveStatus = (status: string): boolean => status !== 'completed'

const spinnerAt = (frame: number): string => SPINNER[((frame % SPINNER.length) + SPINNER.length) % SPINNER.length] ?? SPINNER[0]

/** The glyph a row of this status draws at this level, on this spinner frame. */
export const glyphOf = (status: RowStatus, level: RowLevel, frame: number): Glyph => {
  switch (status) {
    case 'success':
      return { glyph: '✓', color: 'success' }
    case 'failure':
      return { glyph: '✗', color: 'error' }
    case 'running':
      return { glyph: level === 'step' ? spinnerAt(frame) : '◐', color: 'warning' }
    case 'action':
      return { glyph: '!', color: 'warning' }
    case 'cancelled':
      return { glyph: '⊘', dim: true }
    case 'queued':
      return { glyph: '○', dim: true }
  }
}
