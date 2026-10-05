import { describe, expect, test } from 'claude-code/testing'
import { allocateCells, halfBlocks, markerIndex } from './bar'

const FIXTURE = [6_400, 8_200, 3_000, 1_600, 8_800]
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

describe('allocateCells', () => {
  test('rounds each category, at least one cell for any with tokens (design fixture)', () => {
    const cells = allocateCells(FIXTURE, 200_000, 60)
    expect(cells).toEqual([2, 2, 1, 1, 3])
    expect(sum(cells)).toBe(9)
  })
  test('a category with no tokens gets no cell', () => {
    expect(allocateCells([6_400, 0, 100], 200_000, 60)).toEqual([2, 0, 1])
  })
  test('more categories than cells drops the smallest, never passing the width', () => {
    expect(allocateCells([10, 20, 30, 40, 50], 100, 3)).toEqual([0, 0, 1, 1, 1])
    expect(allocateCells([50, 40, 30, 20, 10], 100, 2)).toEqual([1, 1, 0, 0, 0])
  })
  test('over the width trims from the largest category', () => {
    expect(allocateCells([150_000, 100_000], 200_000, 10)).toEqual([5, 5])
  })
  test('largest remainder at the 1c width', () => {
    expect(allocateCells(FIXTURE, 200_000, 100)).toEqual([3, 4, 2, 1, 4])
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
