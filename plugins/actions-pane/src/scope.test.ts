import { describe, expect, test } from 'claude-code/testing'
import type { ActionsContext } from '../types'
import { effectiveScope, isInScope, listFilter, scopeLabel } from './scope'
import { runOf } from './testing/builders'

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const ON_MAIN: ActionsContext = { cwd: '/r', branch: 'main', sha: SHA, repo: 'acme/widgets' }
const DETACHED: ActionsContext = { ...ON_MAIN, branch: null }

describe('effectiveScope', () => {
  test('branch falls back to commit on a detached HEAD; the rest stand', () => {
    expect(effectiveScope('branch', ON_MAIN)).toBe('branch')
    expect(effectiveScope('branch', DETACHED)).toBe('commit')
    expect(effectiveScope('commit', ON_MAIN)).toBe('commit')
    expect(effectiveScope('repo', DETACHED)).toBe('repo')
  })
})

describe('listFilter', () => {
  test('per scope; a commit scope with no HEAD yet lists nothing', () => {
    expect(listFilter('branch', ON_MAIN)).toEqual({ kind: 'branch', branch: 'main' })
    expect(listFilter('branch', DETACHED)).toEqual({ kind: 'commit', sha: SHA })
    expect(listFilter('commit', ON_MAIN)).toEqual({ kind: 'commit', sha: SHA })
    expect(listFilter('repo', ON_MAIN)).toEqual({ kind: 'repo' })
    expect(listFilter('commit', { ...ON_MAIN, sha: null })).toBe(null)
  })
})

describe('scopeLabel', () => {
  test('the branch, the short sha, or owner/repo', () => {
    expect(scopeLabel('branch', ON_MAIN)).toBe('main')
    expect(scopeLabel('branch', DETACHED)).toBe('a1b2c3d')
    expect(scopeLabel('commit', ON_MAIN)).toBe('a1b2c3d')
    expect(scopeLabel('repo', ON_MAIN)).toBe('acme/widgets')
  })
})

describe('isInScope', () => {
  test('matches the run on the branch, the commit, or anything in the repo', () => {
    const run = runOf({ branch: 'main', sha: SHA })
    const other = runOf({ branch: 'feature', sha: 'ffff' })
    expect([isInScope(run, 'branch', ON_MAIN), isInScope(other, 'branch', ON_MAIN)]).toEqual([true, false])
    expect([isInScope(run, 'commit', ON_MAIN), isInScope(other, 'commit', ON_MAIN)]).toEqual([true, false])
    expect(isInScope(other, 'branch', DETACHED)).toBe(false)
    expect(isInScope(other, 'repo', ON_MAIN)).toBe(true)
  })
})
