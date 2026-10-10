import { describe, expect, test } from 'claude-code/testing'
import { formatDuration, glyphOf, SPINNER, statusOf, truncate } from './format'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

describe('formatDuration', () => {
  test('under a second is 0s; seconds alone under a minute', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(999)).toBe('0s')
    expect(formatDuration(2 * SECOND)).toBe('2s')
    expect(formatDuration(59 * SECOND + 999)).toBe('59s')
  })
  test('minutes with zero-padded seconds', () => {
    expect(formatDuration(MINUTE)).toBe('1m 00s')
    expect(formatDuration(MINUTE + 4 * SECOND)).toBe('1m 04s')
    expect(formatDuration(59 * MINUTE + 59 * SECOND)).toBe('59m 59s')
  })
  test('from an hour, hours with zero-padded minutes', () => {
    expect(formatDuration(HOUR)).toBe('1h 00m')
    expect(formatDuration(HOUR + 4 * MINUTE + 59 * SECOND)).toBe('1h 04m')
    expect(formatDuration(26 * HOUR)).toBe('26h 00m')
  })
  test('null and negative (clock skew) read as nothing and 0s', () => {
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(-5 * SECOND)).toBe('0s')
  })
})

describe('truncate', () => {
  test('fits as is; past the width, cut with an ellipsis in the last cell', () => {
    expect(truncate('lint', 10)).toBe('lint')
    expect(truncate('test (node 20)', 14)).toBe('test (node 20)')
    expect(truncate('test (node 20)', 8)).toBe('test (n…')
    expect(truncate('abc', 1)).toBe('…')
    expect(truncate('abc', 0)).toBe('')
  })
  test('counts code points, not UTF-16 units', () => {
    expect(truncate('a—b—c', 4)).toBe('a—b…')
  })
})

describe('statusOf', () => {
  test('maps GitHub status and conclusion onto what the pane draws', () => {
    expect(statusOf('completed', 'success')).toBe('success')
    expect(statusOf('completed', 'failure')).toBe('failure')
    expect(statusOf('completed', 'timed_out')).toBe('failure')
    expect(statusOf('completed', 'startup_failure')).toBe('failure')
    expect(statusOf('completed', 'cancelled')).toBe('cancelled')
    expect(statusOf('completed', 'skipped')).toBe('cancelled')
    expect(statusOf('completed', 'neutral')).toBe('cancelled')
    expect(statusOf('completed', 'action_required')).toBe('action')
    expect(statusOf('in_progress', null)).toBe('running')
    for (const waiting of ['queued', 'waiting', 'pending', 'requested']) expect(statusOf(waiting, null)).toBe('queued')
  })
})

describe('glyphOf', () => {
  test('icons and colours per status, theme keys only', () => {
    expect(glyphOf('success', 'job', 0)).toEqual({ glyph: '✓', color: 'success' })
    expect(glyphOf('failure', 'step', 0)).toEqual({ glyph: '✗', color: 'error' })
    expect(glyphOf('queued', 'job', 0)).toEqual({ glyph: '○', dim: true })
    expect(glyphOf('cancelled', 'run', 0)).toEqual({ glyph: '⊘', dim: true })
    expect(glyphOf('action', 'run', 0)).toEqual({ glyph: '!', color: 'warning' })
  })
  test('a running run or job is ◐; a running step spins frame by frame', () => {
    expect(glyphOf('running', 'run', 3)).toEqual({ glyph: '◐', color: 'warning' })
    expect(glyphOf('running', 'job', 3)).toEqual({ glyph: '◐', color: 'warning' })
    expect(glyphOf('running', 'step', 0)).toEqual({ glyph: '⠋', color: 'warning' })
    expect(glyphOf('running', 'step', 1)).toEqual({ glyph: '⠙', color: 'warning' })
    expect(glyphOf('running', 'step', SPINNER.length + 1)).toEqual({ glyph: '⠙', color: 'warning' })
  })
})
