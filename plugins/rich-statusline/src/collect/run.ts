// The process-runner shape the collectors take, so tests inject their own.

export type RunResult = { exitCode: number; stdout: string; stderr: string }

export type Run = (argv: readonly string[], init?: { cwd?: string; timeoutMs?: number }) => Promise<RunResult>

/** Runs and never rejects: a command that cannot start reads as null. */
export const tryRun = async (run: Run, argv: readonly string[], cwd: string, timeoutMs: number): Promise<RunResult | null> => {
  try {
    return await run(argv, { cwd, timeoutMs })
  } catch {
    return null
  }
}
