// The collectors' lifecycle: timers, a debounced breakdown, cached results.
// Created once per module load (a hot reload drops it with its timers). It
// never sees `$`: the hooks hand it Ports, closures over their own `$` calls.
import type { RichStatuslineBreakdown, RichStatuslineGit, RichStatuslineIdentity, RichStatuslinePr, RichStatuslineUsage } from '../types'
import { collectGit } from './collect/git'
import { collectPr } from './collect/pr'
import type { Run } from './collect/run'
import { type MeasuredBreakdown, type MeasuredUsage, toBreakdown, toUsage } from './collect/usage'
import { effortOf, withCwd, withSession } from './identity'
import { parseSettings, type Settings } from './settings'

export const BREAKDOWN_DEBOUNCE_MS = 2_000
export const TICK_MS = 60_000
const MS_PER_SECOND = 1_000

export type Timer = { cancel: () => void }

type Change<T> = (held: T) => T

export type Ports = {
  run: Run
  model: () => Promise<string>
  cwd: () => Promise<string>
  home: () => Promise<string | undefined>
  configuredEffort: () => Promise<unknown>
  usage: () => Promise<MeasuredUsage & { context: { breakdown?: MeasuredBreakdown } }>
  now: () => Promise<number>
  every: (ms: number, fn: () => void) => Timer
  after: (ms: number, fn: () => void) => Timer
  storedSettings: () => Promise<unknown>
  registerCommand: () => Promise<unknown>
  log: (text: string) => void
  git: { get: () => Promise<RichStatuslineGit | null>; set: (value: RichStatuslineGit) => Promise<unknown> }
  pr: { set: (value: RichStatuslinePr) => Promise<unknown> }
  identity: {
    get: () => Promise<RichStatuslineIdentity | null>
    update: (change: Change<RichStatuslineIdentity | null>) => Promise<unknown>
  }
  usageState: { set: (value: RichStatuslineUsage) => Promise<unknown> }
  breakdown: { set: (value: RichStatuslineBreakdown) => Promise<unknown> }
  clockState: { set: (value: number) => Promise<unknown> }
  settings: { set: (value: Settings) => Promise<unknown> }
}

export type Runtime = {
  /** Starts collecting with these ports, once per load; later calls do nothing. */
  attach: (ports: Ports) => void
  isAttached: () => boolean
  /** Asks for a breakdown once the context has been quiet for the debounce. */
  contextChanged: () => void
  cwdMaybeChanged: () => Promise<void>
  /** Restarts the refresh timers when their intervals changed. */
  retime: (settings: Settings) => void
}

/** Runs `task` unless the same one is still in flight. */
const singleFlight = (task: () => Promise<void>) => {
  let isRunning = false
  return async (): Promise<void> => {
    if (isRunning) return
    isRunning = true
    try {
      await task()
    } finally {
      isRunning = false
    }
  }
}

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const collectors = (ports: Ports) => {
  const cwdOf = async (): Promise<string> => (await ports.identity.get())?.cwd || (await ports.cwd())
  const refreshPr = singleFlight(async () => {
    const branch = (await ports.git.get())?.branch ?? null
    const label = branch === null ? null : await collectPr(ports.run, await cwdOf())
    await ports.pr.set({ label, branch })
  })
  const refreshGit = singleFlight(async () => {
    const before = (await ports.git.get())?.branch
    const git = await collectGit(ports.run, await cwdOf())
    await ports.git.set(git)
    if (git.branch !== before) await refreshPr()
  })
  const loadBreakdown = async (): Promise<void> => {
    const usage = await ports.usage()
    await ports.usageState.set(toUsage(usage))
    if (usage.context.breakdown !== undefined) await ports.breakdown.set(toBreakdown(usage.context.breakdown))
  }
  const loadIdentity = async (): Promise<void> => {
    const [model, cwd, home, effort] = await Promise.all([ports.model(), ports.cwd(), ports.home(), ports.configuredEffort()])
    const configuredEffort = effortOf(effort)
    await ports.identity.update(held =>
      withSession(held, { model, cwd, ...(home === undefined ? {} : { home }), ...(configuredEffort === undefined ? {} : { configuredEffort }) }),
    )
  }
  const tick = async (): Promise<void> => {
    await ports.clockState.set(await ports.now())
  }
  return { refreshPr, refreshGit, loadBreakdown, loadIdentity, tick }
}

export const createRuntime = (): Runtime => {
  let ports: Ports | null = null
  let work: ReturnType<typeof collectors> | null = null
  let timers: Timer[] = []
  let pendingBreakdown: Timer | null = null

  const background = (what: string, task: () => Promise<void>): void => {
    task().catch(error => ports?.log(`rich-statusline: ${what} failed: ${describeError(error)}`))
  }

  const startTimers = (p: Ports, w: ReturnType<typeof collectors>, settings: Settings): void => {
    timers.forEach(timer => timer.cancel())
    timers = [
      p.every(settings.gitRefreshSeconds * MS_PER_SECOND, () => background('git', w.refreshGit)),
      p.every(settings.prRefreshSeconds * MS_PER_SECOND, () => background('pr', w.refreshPr)),
      p.every(TICK_MS, () => background('tick', w.tick)),
    ]
  }

  const start = async (p: Ports, w: ReturnType<typeof collectors>): Promise<void> => {
    await p.registerCommand()
    const settings = parseSettings(await p.storedSettings())
    await p.settings.set(settings)
    await Promise.all([w.loadIdentity(), w.tick(), w.loadBreakdown()])
    startTimers(p, w, settings)
    await w.refreshGit()
  }

  return {
    attach: next => {
      if (ports !== null) return
      ports = next
      const w = collectors(next)
      work = w
      background('start', () => start(next, w))
    },
    isAttached: () => ports !== null,
    contextChanged: () => {
      const p = ports
      const w = work
      if (p === null || w === null) return
      pendingBreakdown?.cancel()
      pendingBreakdown = p.after(BREAKDOWN_DEBOUNCE_MS, () => {
        pendingBreakdown = null
        background('breakdown', w.loadBreakdown)
      })
    },
    cwdMaybeChanged: async () => {
      const p = ports
      const w = work
      if (p === null || w === null) return
      const cwd = await p.cwd()
      if ((await p.identity.get())?.cwd === cwd) return
      await p.identity.update(held => withCwd(held, cwd))
      await w.refreshGit()
    },
    retime: settings => {
      if (ports !== null && work !== null) startTimers(ports, work, settings)
    },
  }
}
