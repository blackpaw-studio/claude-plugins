import { describe, expect, test } from 'claude-code/testing'
import { createFooterGate, fitsTail } from './footer'

const HINT = '⏵⏵ accept edits on (shift+tab to cycle)' // 39 columns

describe('fitsTail', () => {
  test('a wide row has room for the tail', () => {
    expect(fitsTail({ columns: 100, hint: HINT, separator: '  ' })).toBe(true)
  })

  test('the engine pads two columns each side; the tail needs four after the hint and separator', () => {
    const edge = 4 + 39 + 2 + 4
    expect(fitsTail({ columns: edge, hint: HINT, separator: '  ' })).toBe(true)
    expect(fitsTail({ columns: edge - 1, hint: HINT, separator: '  ' })).toBe(false)
  })

  test('a tail another hook set takes room too', () => {
    expect(fitsTail({ columns: 70, hint: HINT, separator: '  ' })).toBe(true)
    expect(fitsTail({ columns: 70, hint: HINT, tail: '5h 40% · 7d 12%', separator: '  ' })).toBe(false)
  })

  test('an unknown width does not fit', () => {
    expect(fitsTail({ columns: undefined, hint: HINT, separator: '  ' })).toBe(false)
  })
})

describe('the footer gate', () => {
  test('nothing reported yet: not showing', () => {
    expect(createFooterGate().isShowing()).toBe(false)
  })

  test('holds the last report', () => {
    const gate = createFooterGate()
    gate.report(true)
    expect(gate.isShowing()).toBe(true)
    gate.report(false)
    expect(gate.isShowing()).toBe(false)
  })
})
