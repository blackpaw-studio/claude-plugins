import { expect, test } from 'claude-code/testing'
import { levelFor } from './thresholds'

const T = { amberPercent: 70, redPercent: 90 }

test('levels switch at the thresholds, inclusive', () => {
  expect(levelFor(69.9, T)).toBe('ok')
  expect(levelFor(70, T)).toBe('amber')
  expect(levelFor(89, T)).toBe('amber')
  expect(levelFor(90, T)).toBe('red')
  expect(levelFor(140, T)).toBe('red')
})
