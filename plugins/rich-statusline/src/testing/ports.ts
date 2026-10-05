// Fake Ports for runtime tests: state in memory, timers fired by hand, and
// a git/gh runner the test answers (or holds) per call.
import type { RichStatuslineGit, RichStatuslineIdentity, RichStatuslinePr } from '../../types'
import type { RunInit, RunResult } from '../collect/run'
import type { Ports, Timer } from '../runtime'

export type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }

export const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

/** Lets every pending promise chain run. */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 100; i += 1) await Promise.resolve()
}

export const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: '' })

export type Call = { argv: string; cwd: string; answer: Deferred<RunResult> }

export type FakeWorld = {
  ports: Ports
  calls: Call[]
  gitSets: RichStatuslineGit[]
  prSets: RichStatuslinePr[]
  identity: () => RichStatuslineIdentity | null
  everyCount: () => number
  fireAfter: () => void
  setCwd: (cwd: string) => void
}

/** Answers git for a repo rooted at the cwd on branch `main`, gh with #1. */
export const answerFor = (argv: string, cwd: string): RunResult => {
  if (argv.includes('--show-toplevel')) return ok(`${cwd}\n`)
  if (argv.includes('--abbrev-ref')) return ok('main\n')
  if (argv.startsWith('gh')) return ok('{"number":1,"state":"OPEN"}')
  return ok('')
}

export type FakeOptions = {
  /** Calls whose argv starts with one of these are held until the test answers. */
  hold?: readonly string[]
  overrides?: Partial<Ports>
}

export const fakeWorld = ({ hold = [], overrides = {} }: FakeOptions = {}): FakeWorld => {
  let cwd = '/a'
  let identity: RichStatuslineIdentity | null = null
  let git: RichStatuslineGit | null = null
  let everyCount = 0
  let afters: (() => void)[] = []
  const calls: Call[] = []
  const gitSets: RichStatuslineGit[] = []
  const prSets: RichStatuslinePr[] = []
  const timer: Timer = { cancel: () => undefined }
  const run = (argv: readonly string[], init?: RunInit): Promise<RunResult> => {
    const call = { argv: argv.join(' '), cwd: init?.cwd ?? '', answer: deferred<RunResult>() }
    calls.push(call)
    if (!hold.some(prefix => call.argv.startsWith(prefix))) call.answer.resolve(answerFor(call.argv, call.cwd))
    return call.answer.promise
  }
  const ports: Ports = {
    run,
    model: async () => 'claude-opus-5-5',
    cwd: async () => cwd,
    home: async () => '/h',
    configuredEffort: async () => 'medium',
    usage: async () => ({ context: { window: 200_000 }, rateLimits: [] }),
    now: async () => 1,
    every: () => {
      everyCount += 1
      return timer
    },
    after: (_ms, fn) => {
      afters = [...afters, fn]
      return timer
    },
    storedSettings: async () => undefined,
    registerCommand: async () => undefined,
    log: () => undefined,
    git: {
      get: async () => git,
      set: async value => {
        git = value
        gitSets.push(value)
      },
    },
    pr: { set: async value => void prSets.push(value) },
    identity: {
      get: async () => identity,
      update: async change => {
        identity = change(identity)
      },
    },
    usageState: { set: async () => undefined },
    breakdown: { set: async () => undefined },
    clockState: { set: async () => undefined },
    settings: { set: async () => undefined },
    ...overrides,
  }
  return {
    ports,
    calls,
    gitSets,
    prSets,
    identity: () => identity,
    everyCount: () => everyCount,
    fireAfter: () => {
      const due = afters
      afters = []
      due.forEach(fn => fn())
    },
    setCwd: next => {
      cwd = next
    },
  }
}
