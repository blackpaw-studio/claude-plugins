// How long until the next poll. Pure.
import type { Settings } from './settings'

/** How long a push kick holds the active rate. */
export const KICK_MS = 2 * 60 * 1000

export type ScheduleInputs = {
  settings: Settings
  isActive: boolean
  /** Whether the pane is open: nothing active and no pane is only a slow sweep. */
  isPaneOpen: boolean
  /** How much longer a rate-limit backoff holds every poll off; 0 with none. */
  suspendedForMs: number
  /** Local time a push kick's fast polling ends; 0 with none. */
  kickUntil: number
  now: number
}

const cadenceMs = ({ settings, isActive, isPaneOpen, kickUntil, now }: ScheduleInputs): number => {
  if (isActive || now < kickUntil) return settings.activePollMs
  return isPaneOpen ? settings.idlePollMs : settings.hiddenIdlePollMs
}

export const nextPollMs = (inputs: ScheduleInputs): number => Math.max(cadenceMs(inputs), inputs.suspendedForMs)
