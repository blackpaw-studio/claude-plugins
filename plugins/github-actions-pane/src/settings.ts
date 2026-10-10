// The mod's userConfig options to settings, with the poll floors held. Pure.
import type { ActionsScope } from '../types'

export type Settings = {
  scope: ActionsScope
  lingerMs: number
  activePollMs: number
  idlePollMs: number
  autoOpen: boolean
}

const SECOND = 1000
const ACTIVE_FLOOR_MS = 5 * SECOND
const IDLE_FLOOR_MS = 15 * SECOND
export const SCOPES: readonly ActionsScope[] = ['commit', 'branch', 'repo']

export const DEFAULT_SETTINGS: Settings = {
  scope: 'branch',
  lingerMs: 30 * SECOND,
  activePollMs: 10 * SECOND,
  idlePollMs: 60 * SECOND,
  autoOpen: false,
}

export const isScope = (value: unknown): value is ActionsScope => SCOPES.includes(value as ActionsScope)

const secondsOf = (value: unknown, fallbackMs: number, floorMs: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(floorMs, Math.round(value * SECOND)) : fallbackMs

export const parseSettings = (options: Readonly<Record<string, unknown>>): Settings => ({
  scope: isScope(options.scope) ? options.scope : DEFAULT_SETTINGS.scope,
  lingerMs: secondsOf(options.lingerSeconds, DEFAULT_SETTINGS.lingerMs, 0),
  activePollMs: secondsOf(options.activePollSeconds, DEFAULT_SETTINGS.activePollMs, ACTIVE_FLOOR_MS),
  idlePollMs: secondsOf(options.idlePollSeconds, DEFAULT_SETTINGS.idlePollMs, IDLE_FLOOR_MS),
  autoOpen: typeof options.autoOpen === 'boolean' ? options.autoOpen : DEFAULT_SETTINGS.autoOpen,
})
