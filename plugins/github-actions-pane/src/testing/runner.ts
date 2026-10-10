// A process runner for collector tests: answers by argv, records each call.
import type { RunInit, RunResult } from '../collect/run'

export const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: '' })
export const fail = (stderr: string, exitCode = 1): RunResult => ({ exitCode, stdout: '', stderr })

export type Asked = { argv: string; init?: RunInit }

/** Answers each argv (joined by spaces) from the table; an Error rejects, an unknown argv throws. */
export const runner = (answers: Readonly<Record<string, RunResult | Error>>) => {
  const asked: Asked[] = []
  const run = async (argv: readonly string[], init?: RunInit): Promise<RunResult> => {
    const key = argv.join(' ')
    asked.push({ argv: key, ...(init === undefined ? {} : { init }) })
    const answer = answers[key]
    if (answer === undefined) throw new Error(`unexpected: ${key}`)
    if (answer instanceof Error) throw answer
    return answer
  }
  return { run, asked }
}
