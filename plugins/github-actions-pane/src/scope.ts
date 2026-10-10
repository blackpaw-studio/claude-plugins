// What a scope means against the session's context: the list filter, the
// header label, and which runs belong. Pure.
import type { ActionsContext, ActionsRun, ActionsScope } from '../types'
import type { ListFilter } from './collect/gh'

const SHORT_SHA = 7

export const shortSha = (sha: string): string => sha.slice(0, SHORT_SHA)

/** Branch scope on a detached HEAD has no branch to follow: it follows HEAD's commit. */
export const effectiveScope = (scope: ActionsScope, context: ActionsContext): ActionsScope =>
  scope === 'branch' && context.branch === null ? 'commit' : scope

/** A tag-push run is named after the tag, not the branch: the branch's runs, plus any run on HEAD's commit. */
const branchFilter = (branch: string, sha: string | null): ListFilter =>
  sha === null ? { kind: 'branch', branch } : { kind: 'any', of: [{ kind: 'branch', branch }, { kind: 'commit', sha }] }

/** How gh filters the list; null when the scope has nothing to match yet (no commit). */
export const listFilter = (scope: ActionsScope, context: ActionsContext): ListFilter | null => {
  const effective = effectiveScope(scope, context)
  if (effective === 'repo') return { kind: 'repo' }
  if (effective === 'branch' && context.branch !== null) return branchFilter(context.branch, context.sha)
  return context.sha === null ? null : { kind: 'commit', sha: context.sha }
}

export const scopeLabel = (scope: ActionsScope, context: ActionsContext): string => {
  const effective = effectiveScope(scope, context)
  if (effective === 'repo') return context.repo
  if (effective === 'branch' && context.branch !== null) return context.branch
  return context.sha === null ? 'no commits' : shortSha(context.sha)
}

export const isInScope = (run: ActionsRun, scope: ActionsScope, context: ActionsContext): boolean => {
  const effective = effectiveScope(scope, context)
  if (effective === 'repo') return true
  if (effective === 'branch') return run.branch === context.branch || (context.sha !== null && run.sha === context.sha)
  return context.sha !== null && run.sha === context.sha
}
