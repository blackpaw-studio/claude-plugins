// Pure updates of the identity value: from the session, and from a model step.
import type { RichStatuslineIdentity } from '../types'

export const effortOf = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : undefined

export type SessionFacts = { model: string; cwd: string; home?: string; configuredEffort?: string }

/** The session's facts; an effort a step already reported wins over settings. */
export const withSession = (held: RichStatuslineIdentity | null, facts: SessionFacts): RichStatuslineIdentity => {
  const effort = held?.effort ?? facts.configuredEffort
  return {
    model: facts.model,
    cwd: facts.cwd,
    ...(facts.home === undefined ? {} : { home: facts.home }),
    ...(effort === undefined ? {} : { effort }),
  }
}

/** A main-loop step's model and effort; a step without effort clears it. */
export const withStep = (
  held: RichStatuslineIdentity | null,
  step: { model: string; effort?: string | number },
): RichStatuslineIdentity => {
  const effort = effortOf(step.effort)
  const base = { model: step.model, cwd: held?.cwd ?? '', ...(held?.home === undefined ? {} : { home: held.home }) }
  return effort === undefined ? base : { ...base, effort }
}

export const withCwd = (held: RichStatuslineIdentity | null, cwd: string): RichStatuslineIdentity | null =>
  held === null ? held : { ...held, cwd }
