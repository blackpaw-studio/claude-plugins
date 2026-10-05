import { describe, expect, test } from 'claude-code/testing'
import {
  abbreviatePath,
  displayModel,
  formatCost,
  formatDuration,
  formatDurationCompact,
  formatTokens,
  shortEffort,
} from './format'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatTokens', () => {
  test('keeps small counts whole', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(850)).toBe('850')
  })
  test('one decimal under ten thousand', () => {
    expect(formatTokens(6_400)).toBe('6.4k')
    expect(formatTokens(3_000)).toBe('3.0k')
    expect(formatTokens(1_640)).toBe('1.6k')
  })
  test('whole thousands from ten thousand', () => {
    expect(formatTokens(28_000)).toBe('28k')
    expect(formatTokens(172_000)).toBe('172k')
    expect(formatTokens(200_000)).toBe('200k')
    expect(formatTokens(27_900)).toBe('28k')
  })
  test('millions drop a trailing .0', () => {
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(1_250_000)).toBe('1.3M')
  })
  test('rounding into the next unit moves up', () => {
    expect(formatTokens(9_990)).toBe('10k')
    expect(formatTokens(999_600)).toBe('1M')
  })
})

describe('formatDuration', () => {
  test('days, hours and minutes', () => {
    expect(formatDuration(DAY + 12 * HOUR + 11 * MINUTE)).toBe('1d 12h 11m')
    expect(formatDuration(HOUR + 11 * MINUTE + 59_000)).toBe('1h 11m')
    expect(formatDuration(11 * MINUTE)).toBe('11m')
  })
  test('never negative', () => {
    expect(formatDuration(-5_000)).toBe('0m')
  })
  test('compact form drops minutes once days show', () => {
    expect(formatDurationCompact(DAY + 12 * HOUR + 11 * MINUTE)).toBe('1d12h')
    expect(formatDurationCompact(HOUR + 11 * MINUTE)).toBe('1h11m')
    expect(formatDurationCompact(11 * MINUTE)).toBe('11m')
  })
})

describe('abbreviatePath', () => {
  test('home becomes ~ and middle segments shrink to one char', () => {
    expect(abbreviatePath('/Users/evan/.leo/workspace', '/Users/evan')).toBe('~/.l/workspace')
    expect(abbreviatePath('/Users/evan/src/app/web', '/Users/evan')).toBe('~/s/a/web')
  })
  test('home itself and direct children', () => {
    expect(abbreviatePath('/Users/evan', '/Users/evan')).toBe('~')
    expect(abbreviatePath('/Users/evan/code', '/Users/evan/')).toBe('~/code')
  })
  test('outside home keeps the root', () => {
    expect(abbreviatePath('/usr/local/bin', '/Users/evan')).toBe('/u/l/bin')
    expect(abbreviatePath('/', '/Users/evan')).toBe('/')
  })
  test('a sibling sharing the home prefix is not home', () => {
    expect(abbreviatePath('/Users/evanx/code', '/Users/evan')).toBe('/U/e/code')
  })
  test('works without a home', () => {
    expect(abbreviatePath('/srv/app', undefined)).toBe('/s/app')
  })
})

describe('displayModel', () => {
  test('maps model ids to family and version', () => {
    expect(displayModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(displayModel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(displayModel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(displayModel('claude-haiku-4-5')).toBe('Haiku 4.5')
    expect(displayModel('claude-opus-4')).toBe('Opus 4')
  })
  test('leaves names it does not know', () => {
    expect(displayModel('Opus 5.5')).toBe('Opus 5.5')
    expect(displayModel('gpt-oss')).toBe('gpt-oss')
  })
})

describe('small formatters', () => {
  test('cost in dollars', () => {
    expect(formatCost(1.234)).toBe('$1.23')
    expect(formatCost(0)).toBe('$0.00')
  })
  test('effort shortens medium only', () => {
    expect(shortEffort('medium')).toBe('med')
    expect(shortEffort('high')).toBe('high')
  })
})
