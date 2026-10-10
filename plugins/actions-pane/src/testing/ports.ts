// Fake Ports for runtime tests: a clock and timers that move only when the
// test advances them, state in memory, and git/gh answered from a table the
// test edits as the scenario moves on.
import type { ActionsData, ActionsScope } from '../../types'
import type { RunInit, RunResult } from '../collect/run'
import type { PaneState, Ports, Timer } from '../runtime'
import { ok } from './runner'

type Pending = { due: number; fn: () => void; everyMs: number | null; isCancelled: boolean }

export type FakeWorld = {
  ports: Ports
  /** Every argv asked, in order, joined by spaces. */
  asked: string[]
  /** Answers for argv prefixes; the longest matching prefix wins. */
  answers: Map<string, RunResult | Error>
  opens: () => number
  closes: () => number
  statuses: (string | undefined)[]
  data: () => ActionsData | null
  manual: () => boolean
  drawnNow: () => number
  now: () => number
  /** Moves the clock, firing timers due on the way, in order, letting each settle. */
  advance: (ms: number) => Promise<void>
  /** Timers waiting: their delays from now. */
  waiting: () => number[]
  setCwd: (cwd: string) => void
  setPane: (pane: PaneState) => void
  /** The next unasked open is not placed (a narrow terminal). */
  setPlaced: (isPlaced: boolean) => void
}

/** Lets every pending promise chain run. */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve()
}

const longestPrefix = (answers: Map<string, RunResult | Error>, argv: string): RunResult | Error | undefined =>
  [...answers.keys()]
    .filter(prefix => argv.startsWith(prefix))
    .sort((a, b) => b.length - a.length)
    .map(prefix => answers.get(prefix))[0]

export const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

/** git on `main` at SHA in /r, gh resolving acme/widgets with no runs. */
export const baseAnswers = (): Map<string, RunResult | Error> =>
  new Map<string, RunResult | Error>([
    ['git rev-parse HEAD --abbrev-ref HEAD', ok(`${SHA}\nmain\n`)],
    ['gh repo view', ok('{"nameWithOwner":"acme/widgets"}')],
    ['gh run list', ok('[]')],
  ])

export const fakeWorld = (start: number, overrides: Partial<Ports> = {}): FakeWorld => {
  let now = start
  let cwd = '/r'
  let timers: Pending[] = []
  let data: ActionsData | null = null
  let scope: ActionsScope | null = null
  let isManual = false
  let drawnNow = 0
  let opens = 0
  let closes = 0
  let pane: PaneState = { isOpen: false, isPlaced: false }
  let isNextPlaced = true
  const asked: string[] = []
  const statuses: (string | undefined)[] = []
  const answers = baseAnswers()

  const schedule = (ms: number, fn: () => void, everyMs: number | null): Timer => {
    const timer: Pending = { due: now + ms, fn, everyMs, isCancelled: false }
    timers = [...timers, timer]
    return { cancel: () => void (timer.isCancelled = true) }
  }

  const run = async (argv: readonly string[], _init?: RunInit): Promise<RunResult> => {
    const key = argv.join(' ')
    asked.push(key)
    const answer = longestPrefix(answers, key)
    if (answer === undefined) throw new Error(`unexpected: ${key}`)
    if (answer instanceof Error) throw answer
    return answer
  }

  const ports: Ports = {
    run,
    cwd: async () => cwd,
    now: async () => now,
    after: (ms, fn) => schedule(ms, fn, null),
    every: (ms, fn) => schedule(ms, fn, ms),
    data: { get: async () => data, set: async value => void (data = value) },
    clock: { set: async value => void (drawnNow = value) },
    manual: { get: async () => isManual, set: async value => void (isManual = value) },
    scope: { get: async () => scope, set: async value => void (scope = value) },
    open: async () => {
      opens += 1
      pane = { isOpen: true, isPlaced: isNextPlaced }
      return { isPlaced: isNextPlaced }
    },
    close: async () => {
      closes += 1
      pane = { isOpen: false, isPlaced: false }
    },
    pane: async () => pane,
    status: text => void statuses.push(text),
    log: () => undefined,
    ...overrides,
  }

  const advance = async (ms: number): Promise<void> => {
    const target = now + ms
    for (;;) {
      const due = timers.filter(timer => !timer.isCancelled && timer.due <= target).sort((a, b) => a.due - b.due)[0]
      if (due === undefined) break
      now = due.due
      // A repeating timer keeps its record (so a later cancel still reaches it).
      if (due.everyMs === null) timers = timers.filter(timer => timer !== due)
      else due.due += due.everyMs
      due.fn()
      await flush()
    }
    now = target
    await flush()
  }

  return {
    ports,
    asked,
    answers,
    opens: () => opens,
    closes: () => closes,
    statuses,
    data: () => data,
    manual: () => isManual,
    drawnNow: () => drawnNow,
    now: () => now,
    advance,
    waiting: () => timers.filter(timer => !timer.isCancelled).map(timer => timer.due - now).sort((a, b) => a - b),
    setCwd: next => void (cwd = next),
    setPane: next => void (pane = next),
    setPlaced: next => void (isNextPlaced = next),
  }
}
