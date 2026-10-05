// The current branch's pull request through gh; any failure reads as none.
import { type Run, type RunResult, tryRun } from './run'

const GH_TIMEOUT_MS = 15_000

export const parsePr = (result: RunResult | null): string | null => {
  if (result === null || result.exitCode !== 0) return null
  try {
    const parsed: unknown = JSON.parse(result.stdout)
    const number = typeof parsed === 'object' && parsed !== null ? (parsed as { number?: unknown }).number : undefined
    return typeof number === 'number' && Number.isInteger(number) ? `#${number}` : null
  } catch {
    return null
  }
}

export const collectPr = async (run: Run, cwd: string): Promise<string | null> =>
  parsePr(await tryRun(run, ['gh', 'pr', 'view', '--json', 'number,state'], cwd, GH_TIMEOUT_MS))
