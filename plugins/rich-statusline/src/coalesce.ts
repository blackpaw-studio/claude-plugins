// Serializes an async task: one pass at a time, later calls folded into one rerun.

type Outcome = { isFailed: false } | { isFailed: true; error: unknown }

/**
 * Runs `task` one at a time. A call while it runs queues exactly one rerun
 * (later calls fold into it) and resolves when that rerun is done. A pass
 * that rejects still lets the queued pass run; the promise then rejects with
 * the first error.
 */
export const coalesce = (task: () => Promise<void>) => {
  let running: Promise<void> | null = null
  let isQueued = false

  const pass = async (): Promise<Outcome> => {
    try {
      await task()
      return { isFailed: false }
    } catch (error) {
      return { isFailed: true, error }
    }
  }

  const loop = async (): Promise<void> => {
    let failure: Outcome = { isFailed: false }
    do {
      isQueued = false
      const outcome = await pass()
      if (outcome.isFailed && !failure.isFailed) failure = outcome
    } while (isQueued)
    // Cleared in the same turn as the last check: a later call starts afresh.
    running = null
    if (failure.isFailed) throw failure.error
  }

  return (): Promise<void> => {
    if (running !== null) {
      isQueued = true
      return running
    }
    running = loop()
    return running
  }
}
