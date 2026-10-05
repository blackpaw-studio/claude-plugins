// Git root, linked worktree, branch and uncommitted diff stats through an injected runner.
// `undefined` from collectGit means "could not tell": keep the cached value.
import type { RichStatuslineDiff, RichStatuslineGit } from '../../types'
import { type Run, type RunInit, type RunResult, tryRun } from './run'

const GIT_TIMEOUT_MS = 5_000
/** git reads only: never refresh the index (no index.lock fights with commits). */
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0' }
const LOCK_PATTERN = /\.lock\b/
const NO_GIT: RichStatuslineGit = { root: null, worktree: null, branch: null, diff: null }

/** What one git call told us: an answer, a definite no, or nothing to go on. */
type Reading = { kind: 'value'; text: string } | { kind: 'no' } | { kind: 'unknown' }

/** A failure counts as a definite no only when git said why (not killed, not locked). */
const readingOf = (result: RunResult | null): Reading => {
  if (result === null || LOCK_PATTERN.test(result.stderr)) return { kind: 'unknown' }
  if (result.exitCode === 0) return { kind: 'value', text: result.stdout.trim() }
  return result.stderr.trim() === '' ? { kind: 'unknown' } : { kind: 'no' }
}

const countOf = (text: string, pattern: RegExp): number => {
  const match = pattern.exec(text)
  return match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10)
}

/** `git diff --shortstat` output to counts; empty output is a clean tree (+0,-0). */
export const parseShortstat = (stdout: string): RichStatuslineDiff => {
  const text = stdout.trim()
  return {
    insertions: countOf(text, /(\d+) insertions?\(\+\)/),
    deletions: countOf(text, /(\d+) deletions?\(-\)/),
  }
}

const withoutTrailingSlash = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path)
const basename = (path: string): string => withoutTrailingSlash(path).split('/').pop() ?? ''

/**
 * `rev-parse --git-dir --git-common-dir` output to the linked worktree's name:
 * the two differ only in a linked worktree, named after its top-level folder.
 * The last two lines, as an older git echoes an unknown flag first. Pure.
 */
export const parseWorktree = (stdout: string, root: string): string | null => {
  const lines = stdout.split('\n').map(line => line.trim()).filter(line => line !== '')
  if (lines.length < 2) return null
  const [gitDir = '', commonDir = ''] = lines.slice(-2).map(withoutTrailingSlash)
  const name = basename(root)
  return gitDir === commonDir || name === '' ? null : name
}

const gitIn = (run: Run, cwd: string) => {
  const init: RunInit = { cwd, timeoutMs: GIT_TIMEOUT_MS, env: GIT_ENV }
  return async (...args: string[]): Promise<Reading> => readingOf(await tryRun(run, ['git', ...args], init))
}

/** The branch; an unborn one from symbolic-ref, a detached HEAD as its short sha. */
const branchOf = async (git: ReturnType<typeof gitIn>): Promise<Reading> => {
  const abbrev = await git('rev-parse', '--abbrev-ref', 'HEAD')
  if (abbrev.kind === 'unknown') return abbrev
  if (abbrev.kind === 'no') return git('symbolic-ref', '--short', 'HEAD')
  return abbrev.text === 'HEAD' ? git('rev-parse', '--short', 'HEAD') : abbrev
}

export const collectGit = async (run: Run, cwd: string): Promise<RichStatuslineGit | undefined> => {
  const git = gitIn(run, cwd)
  const root = await git('rev-parse', '--show-toplevel')
  if (root.kind !== 'value') return root.kind === 'no' ? NO_GIT : undefined
  const dirs = await git('rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir')
  if (dirs.kind === 'unknown') return undefined
  const branch = await branchOf(git)
  if (branch.kind === 'unknown') return undefined
  const diff = await git('diff', 'HEAD', '--shortstat')
  if (diff.kind === 'unknown') return undefined
  return {
    root: root.text,
    worktree: dirs.kind === 'value' ? parseWorktree(dirs.text, root.text) : null,
    branch: branch.kind === 'value' && branch.text !== '' ? branch.text : null,
    diff: diff.kind === 'value' ? parseShortstat(diff.text) : null,
  }
}
