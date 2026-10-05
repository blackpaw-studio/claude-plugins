import { describe, expect, test } from 'claude-code/testing'
import { allocateCells, halfBlocks, markerIndex } from './bar'

const FIXTURE = [6_400, 8_200, 3_000, 1_600, 8_800]
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

describe('allocateCells', () => {
  test('segments sum to the rounded total fill', () => {
    const cells = allocateCells(FIXTURE, 200_000, 60)
    expect(sum(cells)).toBe(8)
    expect(cells).toEqual([2, 2, 1, 0, 3])
  })
  test('largest remainder at the 1c width', () => {
    expect(allocateCells(FIXTURE, 200_000, 100)).toEqual([3, 4, 2, 1, 4])
  })
  test('over a full window fills exactly the width', () => {
    const cells = allocateCells([150_000, 100_000], 200_000, 10)
    expect(sum(cells)).toBe(10)
  })
  test('empty or invalid inputs fill nothing', () => {
    expect(allocateCells([], 200_000, 60)).toEqual([])
    expect(allocateCells([5, 5], 0, 60)).toEqual([0, 0])
    expect(allocateCells([5, 5], 100, 0)).toEqual([0, 0])
  })
})

describe('markerIndex', () => {
  test('rounds the fraction across the width', () => {
    expect(markerIndex(0.85, 60)).toBe(51)
  })
  test('stays inside the bar', () => {
    expect(markerIndex(1, 60)).toBe(59)
    expect(markerIndex(-1, 60)).toBe(0)
  })
})

describe('halfBlocks', () => {
  test('whole and half cells', () => {
    expect(halfBlocks(10, 10)).toEqual({ full: 1, half: 0, empty: 9 })
    expect(halfBlocks(75, 10)).toEqual({ full: 7, half: 1, empty: 2 })
  })
  test('clamps to the bar', () => {
    expect(halfBlocks(130, 10)).toEqual({ full: 10, half: 0, empty: 0 })
    expect(halfBlocks(-3, 10)).toEqual({ full: 0, half: 0, empty: 10 })
  })
})
