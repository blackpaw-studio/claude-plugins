// How long until the next poll. Pure.
import type { Settings } from './settings'

/** How long a push kick holds the active rate. */
export const KICK_MS = 2 * 60 * 1000

/**
 * The statuses of a run that is executing, the only ones that poll at the
 * active rate. A run `queued`, `waiting` (approval), `requested` or `pending`
 * can sit for hours; it polls at the idle rate until it starts.
 */
export const EXECUTING_STATUSES: ReadonlySet<string> = new Set(['in_progress'])

export type ScheduleInputs = {
  settings: Settings
  /** A run is executing. */
  isActive: boolean
  /** A run is unfinished but not executing (queued, waiting for approval…). */
  isWaiting: boolean
  /** Whether the pane is open: nothing active and no pane is only a slow sweep. */
  isPaneOpen: boolean
  /** How much longer a rate-limit backoff holds every poll off; 0 with none. */
  suspendedForMs: number
  /** Local time a push kick's fast polling ends; 0 with none. */
  kickUntil: number
  now: number
}

/** The poll interval the state asks for, before any rate-limit suspension. */
export const cadenceMs = ({ settings, isActive, isWaiting, isPaneOpen, kickUntil, now }: ScheduleInputs): number => {
  if (isActive || now < kickUntil) return settings.activePollMs
  // A run about to start is worth noticing within a poll, pane or not.
  return isWaiting || isPaneOpen ? settings.idlePollMs : settings.hiddenIdlePollMs
}

export const nextPollMs = (inputs: ScheduleInputs): number => Math.max(cadenceMs(inputs), inputs.suspendedForMs)
