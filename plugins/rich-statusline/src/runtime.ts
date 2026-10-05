// The collectors' lifecycle: timers, a debounced breakdown, cached results.
// Created once per module load (a hot reload drops it with its timers). It
// never sees `$`: the hooks hand it Ports, closures over their own `$` calls.
import type { RichStatuslineBreakdown, RichStatuslineGit, RichStatuslineIdentity, RichStatuslinePr, RichStatuslineUsage } from '../types'
import { coalesce } from './coalesce'
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
  /**
   * Applies an identity change through the attached, serialized identity port;
   * false before attach (nothing else writes identity then).
   */
  updateIdentity: (change: (held: RichStatuslineIdentity | null) => RichStatuslineIdentity | null) => Promise<boolean>
  /** Writes usage through the attached port; false before attach. */
  setUsage: (usage: RichStatuslineUsage) => Promise<boolean>
  /** Writes settings through the attached port; false before attach. */
  setSettings: (settings: Settings) => Promise<boolean>
  /** A new or resumed session: identity, cwd, git and the breakdown again. */
  sessionStarted: () => Promise<void>
  /**
   * A /clear emptied the session's state under this live runtime: seeds it
   * again from a timer, refresh timers left running. A seed asked while one
   * runs folds into one rerun; nothing before attach.
   */
  sessionCleared: () => void
  /**
   * A draw found the state empty (a clear the event missed): as
   * sessionCleared, but at most once per TICK_MS since the last seed began, so
   * a write that keeps failing cannot turn every redraw into a reseed.
   */
  stateMissing: () => void
  /** Restarts the refresh timers when their intervals changed. */
  retime: (settings: Settings) => void
}

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const collectors = (ports: Ports, background: (what: string, task: () => Promise<void>) => void) => {
  const cwdOf = async (): Promise<string> => (await ports.identity.get())?.cwd || (await ports.cwd())
  const refreshPr = coalesce(async () => {
    const git = await ports.git.get()
    const branch = git?.branch ?? null
    const root = git?.root ?? null
    const label = branch === null ? null : await collectPr(ports.run, root ?? (await cwdOf()))
    const now = await ports.git.get()
    const isCurrent = (now?.branch ?? null) === branch && (now?.root ?? null) === root
    if (label !== undefined && isCurrent) await ports.pr.set({ label, root, branch })
  })
  const refreshGit = coalesce(async () => {
    const cwd = await cwdOf()
    const before = await ports.git.get()
    const git = await collectGit(ports.run, cwd)
    if (git === undefined || (await cwdOf()) !== cwd) return
    await ports.git.set(git)
    if (git.branch !== before?.branch || git.root !== before?.root) background('pr', refreshPr)
  })
  const loadBreakdown = async (): Promise<void> => {
    const usage = await ports.usage()
    await ports.usageState.set(toUsage(usage))
    if (usage.context.breakdown !== undefined) await ports.breakdown.set(toBreakdown(usage.context.breakdown))
  }
  const loadIdentity = async (): Promise<void> => {
    const [model, cwd, home, effort] = await Promise.all([
      ports.model(),
      ports.cwd(),
      ports.home(),
      ports.configuredEffort().catch(() => undefined),
    ])
    const configuredEffort = effortOf(effort)
    await ports.identity.update(held =>
      withSession(held, {
        model,
        cwd,
        ...(home === undefined ? {} : { home }),
        ...(configuredEffort === undefined ? {} : { configuredEffort }),
      }),
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
  // Set at attach, each coalesced (one at a time, a burst folds into one rerun):
  // the seed itself, and the draw-asked one that first checks the bound.
  let seeding: (() => Promise<void>) | null = null
  let seedingIfStale: (() => Promise<void>) | null = null
  // When the last seed began; a clock that failed reads as long ago.
  let lastSeedAt: Promise<number> | null = null

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

  /** Starts the refresh timers unless running; a failed start is retried by the next seed. */
  const ensureTimers = (p: Ports, w: ReturnType<typeof collectors>, settings: Settings): void => {
    if (timers.length > 0) return
    try {
      startTimers(p, w, settings)
    } catch (error) {
      p.log(`rich-statusline: timers failed: ${describeError(error)}`)
    }
  }

  /**
   * Settings, then the timers (the first seed starts them), then each first
   * read, each guarded: no failure stops the rest. Without the settings
   * written nothing draws, so the reads are skipped: their writes would only
   * redraw an empty line, which asks for another seed.
   */
  const seed = async (p: Ports, w: ReturnType<typeof collectors>): Promise<void> => {
    lastSeedAt = p.now().catch(() => Number.NEGATIVE_INFINITY)
    const settings = parseSettings(await p.storedSettings().catch(() => undefined))
    const isWritten = await p.settings.set(settings).then(
      () => true,
      error => (p.log(`rich-statusline: settings failed: ${describeError(error)}`), false),
    )
    ensureTimers(p, w, settings)
    if (!isWritten) return
    // Again on a reseed: a command is declared per session, and a second
    // register replaces the first.
    background('command', async () => {
      await p.registerCommand()
    })
    background('identity', w.loadIdentity)
    background('tick', w.tick)
    background('breakdown', w.loadBreakdown)
    background('git', w.refreshGit)
    background('pr', w.refreshPr)
  }

  /** Whether the last seed began at least a tick ago (or none has). */
  const isSeedStale = async (p: Ports): Promise<boolean> => {
    const last = lastSeedAt
    if (last === null) return true
    const [now, then] = await Promise.all([p.now(), last])
    return now - then >= TICK_MS
  }

  /**
   * Each ask gets its own timer (a render hook must not write state), so no
   * flag waits on a callback the engine may refuse to run.
   */
  const later = (p: Ports, what: string, task: () => Promise<void>): void => {
    p.after(0, () => background(what, task))
  }

  return {
    attach: next => {
      if (ports !== null) return
      ports = next
      const w = collectors(next, background)
      work = w
      const run = coalesce(() => seed(next, w))
      seeding = run
      seedingIfStale = coalesce(async () => {
        if (await isSeedStale(next)) await run()
      })
      later(next, 'start', run)
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
    sessionStarted: async () => {
      const w = work
      if (w === null) return
      // Identity first (git reads its cwd), but a failure there stops nothing.
      await w.loadIdentity().catch(error => ports?.log(`rich-statusline: identity failed: ${describeError(error)}`))
      background('breakdown', w.loadBreakdown)
      background('git', w.refreshGit)
    },
    sessionCleared: () => {
      if (ports !== null && seeding !== null) later(ports, 'reseed', seeding)
    },
    stateMissing: () => {
      if (ports !== null && seedingIfStale !== null) later(ports, 'reseed', seedingIfStale)
    },
    updateIdentity: async change => {
      if (ports === null) return false
      await ports.identity.update(change)
      return true
    },
    setUsage: async usage => {
      if (ports === null) return false
      await ports.usageState.set(usage)
      return true
    },
    setSettings: async settings => {
      if (ports === null) return false
      await ports.settings.set(settings)
      return true
    },
    retime: settings => {
      if (ports !== null && work !== null) startTimers(ports, work, settings)
    },
  }
}
