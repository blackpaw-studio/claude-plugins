import { describe, expect, test } from 'claude-code/testing'
import { withHistory, withRuns, workflowsToRead } from './model'
import { dataOf, MINUTE, runOf, T0 } from './testing/builders'

const RUNNING = runOf({ id: 1, workflowId: 10 })
const PASSED = { ...RUNNING, status: 'completed', conclusion: 'success' }

describe('withHistory', () => {
  test('stores the durations read, by workflow id, leaving the others', () => {
    const before = dataOf({ history: { '10': [MINUTE] } })
    const after = withHistory(before, new Map([[20, [2 * MINUTE, 3 * MINUTE]]]))
    expect(after.history).toEqual({ '10': [MINUTE], '20': [2 * MINUTE, 3 * MINUTE] })
    expect(before.history).toEqual({ '10': [MINUTE] })
  })

  test('nothing read leaves the data as is', () => {
    const before = dataOf()
    expect(withHistory(before, new Map())).toBe(before)
  })
})

describe('withRuns and the history', () => {
  test('forgets the history of workflows no longer among the runs', () => {
    const before = dataOf({ history: { '10': [MINUTE], '99': [MINUTE] } })
    expect(withRuns(before, [RUNNING], T0).history).toEqual({ '10': [MINUTE] })
  })

  test('a run seen finishing drops its workflow history: its duration is a new sample', () => {
    const before = dataOf({ runs: [RUNNING], watched: { '1': null }, history: { '10': [MINUTE], '20': [MINUTE] } })
    const other = runOf({ id: 2, workflowId: 20 })
    expect(withRuns(before, [PASSED, other], T0 + MINUTE).history).toEqual({ '20': [MINUTE] })
  })

  test('a run already finished when first listed leaves the history alone', () => {
    const before = dataOf({ history: { '10': [MINUTE] } })
    expect(withRuns(before, [PASSED], T0).history).toEqual({ '10': [MINUTE] })
  })
})

describe('workflowsToRead', () => {
  test('active runs\' workflows with no history yet, once each', () => {
    const data = dataOf({
      runs: [RUNNING, runOf({ id: 2, workflowId: 10, status: 'queued' }), runOf({ id: 3, workflowId: 20 }), runOf({ id: 4, workflowId: 30 })],
      history: { '30': [MINUTE] },
    })
    expect(workflowsToRead(data)).toEqual([10, 20])
  })

  test('an empty history still counts as read; finished runs and runs without a workflow id are skipped', () => {
    const data = dataOf({
      runs: [runOf({ id: 1, workflowId: 10 }), PASSED, runOf({ id: 5, workflowId: null }), runOf({ id: 6, workflowId: 40, status: 'completed' })],
      history: { '10': [] },
    })
    expect(workflowsToRead(data)).toEqual([])
  })
})
