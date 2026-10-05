import { describe, expect, test } from 'claude-code/testing'
import { fitOrTruncate, span, truncateLine } from './line'

describe('truncateLine', () => {
  const line = [span('abc', 'red'), span('defg', 'blue')]
  test('a line that fits is returned as is', () => {
    expect(truncateLine(line, 7)).toBe(line)
  })
  test('cuts at the width, the last cell an ellipsis in the cut span\'s colour', () => {
    expect(truncateLine(line, 5)).toEqual([span('abc', 'red'), span('d…', 'blue')])
    expect(truncateLine(line, 4)).toEqual([span('abc', 'red'), span('…', 'blue')])
    expect(truncateLine(line, 3)).toEqual([span('ab…', 'red')])
  })
  test('counts code points, and a width under one draws nothing', () => {
    expect(truncateLine([span('⎇⎇⎇')], 2)).toEqual([span('⎇…')])
    expect(truncateLine(line, 0)).toEqual([])
  })
})

describe('fitOrTruncate', () => {
  test('the first candidate that fits, else the leanest cut to the width', () => {
    const wide = [span('aaaaaa')]
    const lean = [span('bbbb')]
    expect(fitOrTruncate([wide, lean], 4)).toEqual(lean)
    expect(fitOrTruncate([wide, lean], 3)).toEqual([span('bb…')])
  })
})
