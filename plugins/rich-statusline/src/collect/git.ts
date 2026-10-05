// Git branch and uncommitted diff stats through an injected process runner.
import type { RichStatuslineDiff, RichStatuslineGit } from '../../types'
import { type Run, type RunResult, tryRun } from './run'

const GIT_TIMEOUT_MS = 5_000

export const parseBranch = (result: RunResult | null): string | null => {
  if (result === null || result.exitCode !== 0) return null
  const branch = result.stdout.trim()
  return branch === '' ? null : branch
}

const countOf = (text: string, pattern: RegExp): number => {
  const match = pattern.exec(text)
  return match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10)
}

/** `git diff --shortstat` output to counts; empty output is a clean tree. */
export const parseShortstat = (stdout: string): RichStatuslineDiff | null => {
  const text = stdout.trim()
  if (text === '') return null
  return {
    insertions: countOf(text, /(\d+) insertions?\(\+\)/),
    deletions: countOf(text, /(\d+) deletions?\(-\)/),
  }
}

export const collectGit = async (run: Run, cwd: string): Promise<RichStatuslineGit> => {
  const branch = parseBranch(await tryRun(run, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd, GIT_TIMEOUT_MS))
  if (branch === null) return { branch: null, diff: null }
  const diff = await tryRun(run, ['git', 'diff', 'HEAD', '--shortstat'], cwd, GIT_TIMEOUT_MS)
  return { branch, diff: diff !== null && diff.exitCode === 0 ? parseShortstat(diff.stdout) : null }
}
