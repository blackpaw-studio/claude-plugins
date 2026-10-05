// The process-runner shape the collectors take, so tests inject their own.

export type RunResult = { exitCode: number; stdout: string; stderr: string }

export type RunInit = { cwd?: string; timeoutMs?: number; env?: Record<string, string> }

export type Run = (argv: readonly string[], init?: RunInit) => Promise<RunResult>

/** Runs and never rejects: a run that times out or cannot start reads as null. */
export const tryRun = async (run: Run, argv: readonly string[], init: RunInit): Promise<RunResult | null> => {
  try {
    return await run(argv, init)
  } catch {
    return null
  }
}
