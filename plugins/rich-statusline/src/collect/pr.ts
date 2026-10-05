// The current branch's open pull request through gh. `undefined` means
// "could not tell" (gh missing, timed out): keep the cached value.
import { type Run, type RunResult, tryRun } from './run'

const GH_TIMEOUT_MS = 15_000
const GH_ENV = { GH_PROMPT_DISABLED: '1' }

const fieldsOf = (stdout: string): { number?: unknown; state?: unknown } | null => {
  try {
    const parsed: unknown = JSON.parse(stdout)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

/** `#N` for an open PR; null for none, a closed or merged one, or bad output. */
export const parsePr = (result: RunResult): string | null => {
  if (result.exitCode !== 0) return null
  const fields = fieldsOf(result.stdout)
  const isOpen = fields?.state === 'OPEN'
  return isOpen && typeof fields?.number === 'number' && Number.isInteger(fields.number) ? `#${fields.number}` : null
}

export const collectPr = async (run: Run, cwd: string): Promise<string | null | undefined> => {
  const result = await tryRun(run, ['gh', 'pr', 'view', '--json', 'number,state'], { cwd, timeoutMs: GH_TIMEOUT_MS, env: GH_ENV })
  return result === null ? undefined : parsePr(result)
}
