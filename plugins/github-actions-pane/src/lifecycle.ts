// When the pane opens and closes: a pure state machine over what the
// snapshot shows. The runtime carries out its effects.
import type { Counts } from './snapshot'

export type PaneMode = 'closed' | 'auto' | 'manual'

export type Lifecycle = {
  mode: PaneMode
  /** Runs in flight when the person closed the pane: they do not reopen it. */
  dismissed: readonly number[]
}

/** What the snapshot shows now: the active runs and every run drawn. */
export type View = { activeIds: readonly number[]; shownIds: readonly number[] }

export type LifecycleEvent =
  | { kind: 'poll' | 'tick'; view: View; autoOpen: boolean }
  /** `isPlaced`: whether an open pane is drawn now (an unseated one is seated, not closed). */
  | { kind: 'toggle'; view: View; isPlaced: boolean }
  | { kind: 'closedByPerson'; view: View }

export type Effect = 'open' | 'close' | 'none'

export type Decision = { state: Lifecycle; effect: Effect }

export const CLOSED: Lifecycle = { mode: 'closed', dismissed: [] }

const stay = (state: Lifecycle): Decision => ({ state, effect: 'none' })
const closeHolding = (view: View): Decision => ({ state: { mode: 'closed', dismissed: [...view.activeIds] }, effect: 'close' })

/** Polls open (only polls carry news); polls and ticks close an auto pane once nothing shows. */
const onUpdate = (state: Lifecycle, kind: 'poll' | 'tick', view: View, autoOpen: boolean): Decision => {
  if (state.mode === 'auto') return view.shownIds.length === 0 ? { state: CLOSED, effect: 'close' } : stay(state)
  if (state.mode === 'manual') return stay(state)
  const dismissed = state.dismissed.filter(id => view.activeIds.includes(id))
  const isNews = view.activeIds.some(id => !dismissed.includes(id))
  if (kind === 'poll' && autoOpen && isNews) return { state: { mode: 'auto', dismissed: [] }, effect: 'open' }
  return stay(dismissed.length === state.dismissed.length ? state : { mode: 'closed', dismissed })
}

export const decide = (state: Lifecycle, event: LifecycleEvent): Decision => {
  switch (event.kind) {
    case 'poll':
    case 'tick':
      return onUpdate(state, event.kind, event.view, event.autoOpen)
    case 'toggle':
      return state.mode === 'closed' || !event.isPlaced ? { state: { mode: 'manual', dismissed: [] }, effect: 'open' } : closeHolding(event.view)
    case 'closedByPerson':
      return { ...closeHolding(event.view), effect: 'none' }
  }
}

/**
 * The status line entry while runs show but the pane does not; undefined
 * clears it. The engine already leads it with the plugin's name.
 */
export const statusText = ({ running, failed, passed }: Counts): string | undefined => {
  if (running > 0) return `◐ ${running} running${failed > 0 ? ` · ✗ ${failed} failed` : ''}`
  if (failed > 0) return `✗ ${failed} failed`
  if (passed > 0) return `✓ ${passed} passed`
  return undefined
}
