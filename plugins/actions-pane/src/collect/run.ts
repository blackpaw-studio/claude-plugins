// The process-runner shape the collectors take, so tests inject their own.

export type RunResult = { exitCode: number; stdout: string; stderr: string }

export type RunInit = { cwd?: string; timeoutMs?: number; env?: Record<string, string> }

export type Run = (argv: readonly string[], init?: RunInit) => Promise<RunResult>

/** A run that settled, or one that could not start or timed out, with why. */
export type Ran = { kind: 'ran'; result: RunResult } | { kind: 'failed'; message: string }

/** Runs and never rejects: a run that times out or cannot start reads as `failed`. */
export const tryRun = async (run: Run, argv: readonly string[], init: RunInit): Promise<Ran> => {
  try {
    return { kind: 'ran', result: await run(argv, init) }
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}
