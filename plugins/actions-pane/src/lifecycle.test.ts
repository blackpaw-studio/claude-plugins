import { describe, expect, test } from 'claude-code/testing'
import type { ActionsData } from '../types'
import { CLOSED, decide, type Lifecycle, statusText, type View } from './lifecycle'
import { DEFAULT_SETTINGS } from './settings'
import { buildSnapshot } from './snapshot'
import { dataOf, runOf, SECOND, T0 } from './testing/builders'

const view = (activeIds: number[], shownIds: number[] = activeIds): View => ({ activeIds, shownIds })
const AUTO: Lifecycle = { mode: 'auto', dismissed: [] }
const MANUAL: Lifecycle = { mode: 'manual', dismissed: [] }

describe('auto open', () => {
  test('a poll that sees an active run opens the pane', () => {
    expect(decide(CLOSED, { kind: 'poll', view: view([1]), autoOpen: true })).toEqual({ state: AUTO, effect: 'open' })
  })
  test('nothing active, or autoOpen off: stays closed', () => {
    expect(decide(CLOSED, { kind: 'poll', view: view([]), autoOpen: true })).toEqual({ state: CLOSED, effect: 'none' })
    expect(decide(CLOSED, { kind: 'poll', view: view([1]), autoOpen: false })).toEqual({ state: CLOSED, effect: 'none' })
  })
  test('a tick never opens', () => {
    expect(decide(CLOSED, { kind: 'tick', view: view([1]), autoOpen: true }).effect).toBe('none')
  })
})

describe('closing', () => {
  test('auto closes once nothing is shown', () => {
    expect(decide(AUTO, { kind: 'tick', view: view([], []), autoOpen: true })).toEqual({ state: CLOSED, effect: 'close' })
    expect(decide(AUTO, { kind: 'tick', view: view([], [1]), autoOpen: true })).toEqual({ state: AUTO, effect: 'none' })
  })
  test('opened by hand, it never closes itself', () => {
    expect(decide(MANUAL, { kind: 'tick', view: view([], []), autoOpen: true })).toEqual({ state: MANUAL, effect: 'none' })
  })
})

describe('/actions toggles', () => {
  test('closed opens by hand; open (either way) closes and holds off the runs in flight', () => {
    expect(decide(CLOSED, { kind: 'toggle', view: view([]) })).toEqual({ state: MANUAL, effect: 'open' })
    expect(decide(AUTO, { kind: 'toggle', view: view([1, 2]) })).toEqual({ state: { mode: 'closed', dismissed: [1, 2] }, effect: 'close' })
    expect(decide(MANUAL, { kind: 'toggle', view: view([]) })).toEqual({ state: CLOSED, effect: 'close' })
  })
})

describe('closed by the person', () => {
  test('the runs in flight do not reopen it; a new run does', () => {
    const { state } = decide(AUTO, { kind: 'closedByPerson', view: view([1]) })
    expect(state).toEqual({ mode: 'closed', dismissed: [1] })
    expect(decide(state, { kind: 'poll', view: view([1]), autoOpen: true }).effect).toBe('none')
    expect(decide(state, { kind: 'poll', view: view([1, 2]), autoOpen: true })).toEqual({ state: AUTO, effect: 'open' })
  })
  test('dismissed runs are forgotten once they finish', () => {
    const state: Lifecycle = { mode: 'closed', dismissed: [1, 2] }
    expect(decide(state, { kind: 'poll', view: view([2]), autoOpen: true }).state).toEqual({ mode: 'closed', dismissed: [2] })
  })
})

describe('the timeline, through snapshots on a fake clock', () => {
  const at = (data: ActionsData, now: number) => {
    const snapshot = buildSnapshot({ data, now, settings: DEFAULT_SETTINGS, scope: 'branch', isManual: false })
    return view(snapshot.activeIds, snapshot.shownIds)
  }
  const running = dataOf({ runs: [runOf({ id: 1 })], watched: { 1: null } })
  const doneAt = T0 + 60 * SECOND
  const done = dataOf({ runs: [runOf({ id: 1, status: 'completed', conclusion: 'success' })], watched: { 1: doneAt } })

  test('open while running, linger after it finishes, close at the end of the linger', () => {
    let state = decide(CLOSED, { kind: 'poll', view: at(running, T0), autoOpen: true })
    expect(state.effect).toBe('open')
    state = decide(state.state, { kind: 'poll', view: at(done, doneAt), autoOpen: true })
    expect(state.effect).toBe('none')
    state = decide(state.state, { kind: 'tick', view: at(done, doneAt + 29 * SECOND), autoOpen: true })
    expect(state.effect).toBe('none')
    state = decide(state.state, { kind: 'tick', view: at(done, doneAt + 30 * SECOND), autoOpen: true })
    expect(state).toEqual({ state: CLOSED, effect: 'close' })
  })

  test('a new run during the linger cancels the close', () => {
    const next = dataOf({
      runs: [runOf({ id: 2, createdAt: doneAt + 10 * SECOND }), ...done.runs],
      watched: { ...done.watched, 2: null },
    })
    const state = decide(AUTO, { kind: 'poll', view: at(next, doneAt + 10 * SECOND), autoOpen: true })
    const later = decide(state.state, { kind: 'tick', view: at(next, doneAt + 45 * SECOND), autoOpen: true })
    expect(later).toEqual({ state: AUTO, effect: 'none' })
    expect(at(next, doneAt + 45 * SECOND).shownIds).toEqual([2])
  })
})

describe('statusText', () => {
  test('running first, failures beside; failed alone; passed alone; nothing clears', () => {
    expect(statusText({ running: 2, failed: 0, passed: 1 })).toBe('Actions ◐ 2 running')
    expect(statusText({ running: 1, failed: 1, passed: 0 })).toBe('Actions ◐ 1 running · ✗ 1 failed')
    expect(statusText({ running: 0, failed: 1, passed: 3 })).toBe('Actions ✗ 1 failed')
    expect(statusText({ running: 0, failed: 0, passed: 3 })).toBe('Actions ✓ 3 passed')
    expect(statusText({ running: 0, failed: 0, passed: 0 })).toBe(undefined)
  })
})
