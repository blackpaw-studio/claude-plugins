// How long until the next poll. Pure.
import type { Settings } from './settings'

/** How long a push kick holds the active rate. */
export const KICK_MS = 2 * 60 * 1000

export type ScheduleInputs = {
  settings: Settings
  isActive: boolean
  isRateLimited: boolean
  /** Local time a push kick's fast polling ends; 0 with none. */
  kickUntil: number
  now: number
}

export const nextPollMs = ({ settings, isActive, isRateLimited, kickUntil, now }: ScheduleInputs): number => {
  if (isRateLimited) return settings.idlePollMs
  return isActive || now < kickUntil ? settings.activePollMs : settings.idlePollMs
}
