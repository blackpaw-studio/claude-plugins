// The poller: one serialized poll at a time, rescheduled per the schedule,
// a 1s tick while the pane is open, and the lifecycle's effects carried out.
// Everything outside reaches it through Ports, so tests drive it on a fake
// clock; hooks/register.tsx wires the ports to `$`.
import type { ActionsData, ActionsJob, ActionsScope } from '../types'
import { collectHead } from './collect/git'
import { type GhFailure, type GhResult, listRuns, repoName, viewJobs } from './collect/gh'
import type { Run } from './collect/run'
import { CLOSED, decide, type Effect, type Lifecycle, type LifecycleEvent, statusText } from './lifecycle'
import { EMPTY_DATA, runsToDetail, withJobs, withRuns } from './model'
import { KICK_MS, nextPollMs } from './schedule'
import { listFilter } from './scope'
import type { Settings } from './settings'
import { buildSnapshot, type Snapshot } from './snapshot'

export const TICK_MS = 1000

export type Timer = { cancel: () => void }

export type PaneState = { isOpen: boolean; isPlaced: boolean }

export type Ports = {
  run: Run
  cwd: () => Promise<string>
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => Timer
  every: (ms: number, fn: () => void) => Timer
  /** The $.state values the pane draws from. */
  data: { get: () => Promise<ActionsData | null>; set: (value: ActionsData) => Promise<void> }
  clock: { set: (now: number) => Promise<void> }
  manual: { get: () => Promise<boolean>; set: (isManual: boolean) => Promise<void> }
  scope: { get: () => Promise<ActionsScope | null>; set: (scope: ActionsScope) => Promise<void> }
  /** Opens the pane unasked; resolves whether a surface draws it. */
  open: () => Promise<{ isPlaced: boolean }>
  close: () => Promise<void>
  pane: () => Promise<PaneState>
  status: (text: string | undefined) => void
  log: (text: string) => void
}

/** The answer to the person's `/actions`; a quiet one needs no transcript row. */
export type Reply = { text: string; isQuiet?: true }

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const createRuntime = (ports: Ports, settings: Settings) => {
  let data: ActionsData = EMPTY_DATA
  let lifecycle: Lifecycle = CLOSED
  let isPlaced = true
  let lastCwd: string | null = null
  let kickUntil = 0
  let pollTimer: Timer | null = null
  let tickTimer: Timer | null = null
  let polling: Promise<void> | null = null
  let isPollQueued = false
  /** Finished runs whose jobs were read after they finished: never asked again. */
  let final = new Set<number>()

  const fail = (where: string) => (error: unknown) => ports.log(`github-actions-pane: ${where}: ${describe(error)}`)

  const scopeNow = async (): Promise<ActionsScope> => (await ports.scope.get()) ?? settings.scope

  const snapshotAt = async (now: number): Promise<Snapshot> =>
    buildSnapshot({ data, now, settings, scope: await scopeNow(), isManual: lifecycle.mode === 'manual' })

  const publish = async (next: ActionsData): Promise<void> => {
    data = next
    await ports.data.set(next)
  }

  const showStatus = (snapshot: Snapshot): void => {
    const isPaneShowing = lifecycle.mode !== 'closed' && isPlaced
    ports.status(isPaneShowing ? undefined : statusText(snapshot.counts))
  }

  const startTick = (): void => {
    tickTimer ??= ports.every(TICK_MS, () => void tick().catch(fail('tick')))
  }

  const stopTick = (): void => {
    tickTimer?.cancel()
    tickTimer = null
  }

  const apply = async (effect: Effect, now: number, open: () => Promise<{ isPlaced: boolean }> = ports.open): Promise<void> => {
    if (effect === 'open') {
      // The drawn clock stands still while closed: bring it up before the first frame.
      await ports.clock.set(now)
      isPlaced = (await open()).isPlaced
      startTick()
    }
    if (effect === 'close') {
      stopTick()
      await ports.close()
      isPlaced = true
    }
    if (lifecycle.mode === 'closed') stopTick()
    await ports.manual.set(lifecycle.mode === 'manual')
  }

  const step = async (event: (snapshot: Snapshot) => LifecycleEvent, now: number): Promise<void> => {
    const snapshot = await snapshotAt(now)
    const decision = decide(lifecycle, event(snapshot))
    lifecycle = decision.state
    await apply(decision.effect, now)
    showStatus(await snapshotAt(now))
  }

  const viewOf = (snapshot: Snapshot) => ({ activeIds: snapshot.activeIds, shownIds: snapshot.shownIds })

  const intervalAt = (now: number): number =>
    nextPollMs({ settings, isActive: data.runs.some(run => run.status !== 'completed'), isRateLimited: data.isRateLimited, kickUntil, now })

  const schedule = (now: number): void => {
    pollTimer?.cancel()
    pollTimer = null
    if (data.disabled === null) pollTimer = ports.after(intervalAt(now), () => void poll().catch(fail('poll')))
  }

  const disable = async (reason: string): Promise<void> => {
    final = new Set()
    await publish({ ...EMPTY_DATA, disabled: reason })
  }

  const onFailure = async (failure: GhFailure): Promise<void> => {
    if (failure.kind === 'fatal') return disable(failure.reason)
    if (failure.kind === 'rate-limited') return publish({ ...data, isRateLimited: true })
    ports.log(`github-actions-pane: gh: ${failure.reason}`)
  }

  /** Reads the context; null when the poll stops here (now disabled, or a transient failure logged). */
  const readContext = async (cwd: string): Promise<ActionsData['context']> => {
    const head = await collectHead(ports.run, cwd)
    if (head.kind === 'fatal') {
      await disable(head.reason)
      return null
    }
    if (head.kind === 'transient') {
      ports.log(`github-actions-pane: git: ${head.reason}`)
      return null
    }
    const known = data.context?.cwd === cwd ? data.context.repo : null
    const repo: GhResult<string> = known === null ? await repoName(ports.run, cwd) : { kind: 'ok', value: known }
    if (repo.kind !== 'ok') {
      await onFailure(repo)
      return null
    }
    return { cwd, branch: head.branch, sha: head.sha, repo: repo.value }
  }

  const detail = async (cwd: string, now: number): Promise<void> => {
    const wanted = runsToDetail(data, (await snapshotAt(now)).shownIds, final)
    const answers = await Promise.all(wanted.map(async id => [id, await viewJobs(ports.run, cwd, id)] as const))
    const read = new Map<number, ActionsJob[]>()
    for (const [id, answer] of answers) {
      if (answer.kind !== 'ok') {
        await onFailure(answer)
        continue
      }
      read.set(id, answer.value)
      if (data.runs.find(run => run.id === id)?.status === 'completed') final.add(id)
    }
    await publish(withJobs(data, read))
  }

  const pollOnce = async (): Promise<void> => {
    const cwd = await ports.cwd()
    const now = await ports.now()
    if (cwd !== lastCwd) final = new Set()
    lastCwd = cwd
    const context = await readContext(cwd)
    if (context !== null) {
      const filter = listFilter(await scopeNow(), context)
      const listed: GhResult<ActionsData['runs']> = filter === null ? { kind: 'ok', value: [] } : await listRuns(ports.run, cwd, filter)
      // Another repository: nothing of the last one carries over, whatever the list says.
      const isNewRepo = data.context !== null && data.context.repo !== context.repo
      if (isNewRepo) final = new Set()
      await publish({ ...(isNewRepo ? EMPTY_DATA : data), context, disabled: null })
      if (listed.kind === 'ok') await publish(withRuns(data, listed.value, now))
      else await onFailure(listed)
      await publish({ ...data, pollMs: intervalAt(now) })
      if (data.disabled === null) await detail(cwd, now)
    }
    const settled = await ports.now()
    await step(snapshot => ({ kind: 'poll', view: viewOf(snapshot), autoOpen: settings.autoOpen }), settled)
    schedule(settled)
  }

  /** One poll at a time; a poll asked for meanwhile runs once, right after. */
  const poll = async (): Promise<void> => {
    if (polling !== null) {
      isPollQueued = true
      return polling
    }
    polling = pollOnce().finally(() => {
      polling = null
    })
    await polling
    if (isPollQueued) {
      isPollQueued = false
      await poll()
    }
  }

  const tick = async (): Promise<void> => {
    const now = await ports.now()
    await ports.clock.set(now)
    isPlaced = (await ports.pane()).isPlaced
    await step(snapshot => ({ kind: 'tick', view: viewOf(snapshot), autoOpen: settings.autoOpen }), now)
  }

  return {
    /** Starts watching: restores what a reload left in state, then polls. */
    start: async (): Promise<void> => {
      data = (await ports.data.get()) ?? EMPTY_DATA
      const pane = await ports.pane()
      if (pane.isOpen) {
        lifecycle = { mode: (await ports.manual.get()) ? 'manual' : 'auto', dismissed: [] }
        isPlaced = pane.isPlaced
        startTick()
      }
      await poll()
    },
    poll,
    /** A command that starts runs ran: poll now and at the active rate for a while. */
    kick: async (): Promise<void> => {
      kickUntil = (await ports.now()) + KICK_MS
      await poll()
    },
    /** The session's cwd may have moved (a Bash call): a new place is checked afresh. */
    cwdMaybeChanged: async (): Promise<void> => {
      if ((await ports.cwd()) !== lastCwd) await poll()
    },
    /** `/actions`: opens (asked, through `open`) or closes; idle, says why. */
    toggle: async (open: () => Promise<{ isPlaced: boolean }>): Promise<Reply> => {
      if (lifecycle.mode === 'closed' && data.disabled !== null) await poll()
      if (lifecycle.mode === 'closed' && data.disabled !== null) return { text: `Actions pane: ${data.disabled}.` }
      const now = await ports.now()
      isPlaced = lifecycle.mode === 'closed' || (await ports.pane()).isPlaced
      const decision = decide(lifecycle, { kind: 'toggle', view: viewOf(await snapshotAt(now)), isPlaced })
      lifecycle = decision.state
      await apply(decision.effect, now, open)
      showStatus(await snapshotAt(now))
      if (decision.effect === 'open') void poll().catch(fail('poll'))
      return { text: decision.effect === 'open' ? 'Actions pane opened.' : 'Actions pane closed.', isQuiet: true }
    },
    /** `/actions <scope>`: this session only. */
    setScope: async (scope: ActionsScope): Promise<Reply> => {
      await ports.scope.set(scope)
      final = new Set()
      await poll()
      return { text: `Actions pane scope: ${scope} (this session).` }
    },
    /** The person closed the pane by hand. */
    closedByPerson: async (): Promise<void> => {
      const now = await ports.now()
      const decision = decide(lifecycle, { kind: 'closedByPerson', view: viewOf(await snapshotAt(now)) })
      lifecycle = decision.state
      stopTick()
      await ports.manual.set(false)
      showStatus(await snapshotAt(now))
    },
    /** A /clear emptied the session's state: put back what the pane draws from. */
    republish: async (): Promise<void> => {
      await ports.data.set(data)
      await ports.manual.set(lifecycle.mode === 'manual')
      await ports.clock.set(await ports.now())
    },
    stop: (): void => {
      pollTimer?.cancel()
      stopTick()
    },
  }
}

export type Runtime = ReturnType<typeof createRuntime>
