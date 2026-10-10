import { describe, expect, test } from 'claude-code/testing'
import type { Row } from './jobs'
import { rowsAt, windowSteps, WINDOWS } from './window'

const step = (name: string, status: Row['status']): Row => ({ depth: 1, status, name, durationMs: null })
const names = (rows: readonly Row[]) => rows.map(row => `${row.status} ${row.name}`)

const STEPS: Row[] = [
  ...Array.from({ length: 10 }, (_, i) => step(`done ${i + 1}`, 'success')),
  step('current', 'running'),
  ...Array.from({ length: 9 }, (_, i) => step(`later ${i + 12}`, 'queued')),
]

describe('windowSteps', () => {
  test('roomiest to tightest', () => {
    expect(WINDOWS).toEqual(['all', { before: 2, after: 3 }, { before: 1, after: 1 }, { before: 0, after: 0 }, 'none'])
  })

  test('a window around the current step folds the rest', () => {
    expect(names(windowSteps(STEPS, { before: 2, after: 3 }))).toEqual([
      'success 8 steps',
      'success done 9',
      'success done 10',
      'running current',
      'queued later 12',
      'queued later 13',
      'queued later 14',
      'queued 6 more',
    ])
    expect(names(windowSteps(STEPS, { before: 0, after: 0 }))).toEqual(['success 10 steps', 'running current', 'queued 9 more'])
  })

  test('a fold of one step is the step itself', () => {
    const short = [step('a', 'success'), step('b', 'success'), step('c', 'running'), step('d', 'queued')]
    expect(names(windowSteps(short, { before: 1, after: 1 }))).toEqual(['success a', 'success b', 'running c', 'queued d'])
  })

  test('a failure hidden in a fold marks the fold', () => {
    const steps = [step('flaky', 'failure'), step('b', 'success'), step('c', 'success'), step('d', 'running')]
    expect(names(windowSteps(steps, { before: 0, after: 0 }))).toEqual(['failure 3 steps', 'running d'])
  })

  test('all and none', () => {
    expect(windowSteps(STEPS, 'all')).toEqual(STEPS)
    expect(windowSteps(STEPS, 'none')).toEqual([])
  })
})

describe('rowsAt', () => {
  test("windows only a running job's steps; a failed job's step always shows", () => {
    const jobs = [
      { row: { depth: 0 as const, status: 'running' as const, name: 'build', durationMs: null }, steps: STEPS },
      { row: { depth: 0 as const, status: 'failure' as const, name: 'lint', durationMs: null }, steps: [step('eslint', 'failure')] },
    ]
    expect(names(rowsAt(jobs, 'none'))).toEqual(['running build', 'failure lint', 'failure eslint'])
  })
})
