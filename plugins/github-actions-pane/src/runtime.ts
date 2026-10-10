// The poller: one serialized poll at a time, rescheduled per the schedule,
// a 1s tick while the pane is open, and the lifecycle's effects carried out.
// Everything outside reaches it through Ports, so tests drive it on a fake
// clock; hooks/register.tsx wires the ports to `$`.
import type { ActionsData, ActionsJob, ActionsScope } from '../types'
import { bandAt, isRunningBand } from './band'
import { collectHead } from './collect/git'
import { type GhFailure, type GhResult, listDurations, listRuns, repoName, viewJobs } from './collect/gh'
import { readRef, trackingRefOf } from './collect/remote-ref'
import { repoFromRemotes } from './collect/repo'
import type { Run } from './collect/run'
import { isActiveStatus } from './format'
import { CLOSED, decide, type Effect, type Lifecycle, type LifecycleEvent, statusText } from './lifecycle'
import { EMPTY_DATA, restoredData, runsToDetail, withHistory, withJobs, withRuns, workflowsToRead } from './model'
import { KICK_MS, nextPollMs } from './schedule'
import { listFilter } from './scope'
import type { Settings } from './settings'
import { buildSnapshot, type Snapshot } from './snapshot'

export const TICK_MS = 1000
/** How often the local remote-tracking ref is read: a push from any terminal moves it. Local git only. */
export const REMOTE_WATCH_MS = 5000
/** A ref that moves this soon after a kick is the push that was kicked. */
const KICK_DEDUPE_MS = 2 * REMOTE_WATCH_MS

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
  let ghRepo: { cwd: string; repo: string } | null = null
  let kickUntil = 0
  let lastKickAt = Number.NEGATIVE_INFINITY
  let pollTimer: Timer | null = null
  let tickTimer: Timer | null = null
  let remoteTimer: Timer | null = null
  let isReadingRemote = false
  /** The tracking ref being watched, for this branch in this cwd, and the sha it last held. */
  let tracked: { key: string; ref: string; isConfigured: boolean; sha: string | null } | null = null
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

  const showStatus = (snapshot: Snapshot, isRunningInBand: boolean): void => {
    const isPaneShowing = lifecycle.mode !== 'closed' && isPlaced
    // The band says what runs; the status line keeps what it does not (failures).
    const counts = isRunningInBand ? { ...snapshot.counts, running: 0, passed: 0 } : snapshot.counts
    ports.status(isPaneShowing ? undefined : statusText(counts))
  }

  const bandTextAt = async (now: number): Promise<string | null> => bandAt({ data, now, settings, scope: await scopeNow() })

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
    await ports.manual.set(lifecycle.mode === 'manual')
  }

  /** The tick runs while the pane is open or the band shows; the clock is brought up when it starts. */
  const syncTick = async (now: number, isBandShowing: boolean): Promise<void> => {
    if (lifecycle.mode === 'closed' && !isBandShowing) return stopTick()
    if (tickTimer !== null) return
    await ports.clock.set(now)
    startTick()
  }

  /** The status line, and the tick. */
  const refresh = async (now: number): Promise<void> => {
    const band = await bandTextAt(now)
    showStatus(await snapshotAt(now), isRunningBand(band))
    await syncTick(now, band !== null)
  }

  const step = async (event: (snapshot: Snapshot) => LifecycleEvent, now: number): Promise<void> => {
    const snapshot = await snapshotAt(now)
    const decision = decide(lifecycle, event(snapshot))
    lifecycle = decision.state
    await apply(decision.effect, now)
    await refresh(now)
  }

  const viewOf = (snapshot: Snapshot) => ({ activeIds: snapshot.activeIds, shownIds: snapshot.shownIds })

  const intervalAt = (now: number): number =>
    nextPollMs({ settings, isActive: data.runs.some(run => run.status !== 'completed'), isRateLimited: data.isRateLimited, kickUntil, now })

  const schedule = (now: number): void => {
    pollTimer?.cancel()
    pollTimer = null
    if (data.disabled === null) pollTimer = ports.after(intervalAt(now), () => void poll().catch(fail('poll')))
  }

  /**
   * One look at the tracking ref of the scoped branch. The first look at a
   * branch is a baseline; a later change is a push from outside Claude. The
   * push target is read again on each poll, and on every look while it is
   * only guessed (origin's), so a first `git push -u <remote>` is seen.
   */
  const watchRemote = async (isPoll: boolean): Promise<void> => {
    const context = data.context
    if (context === null || context.branch === null || isReadingRemote) return
    isReadingRemote = true
    try {
      const key = `${context.cwd}\0${context.branch}`
      const known = tracked?.key === key ? tracked : null
      const target = known !== null && known.isConfigured && !isPoll ? known : await trackingRefOf(ports.run, context.cwd, context.branch)
      const read = await readRef(ports.run, context.cwd, target.ref)
      if (read.kind === 'unknown') return
      tracked = { key, ...target, sha: read.sha }
      if (known === null) return
      // Moved to a ref: a push if it moved, or if the push target just became known and holds the branch.
      const isPush = known.ref === target.ref ? known.sha !== read.sha : !known.isConfigured && read.sha !== null
      // A push through Claude's Bash was kicked the moment it ran: the ref moving is the same push.
      if (isPush && (await ports.now()) - lastKickAt > KICK_DEDUPE_MS) await kick()
    } finally {
      isReadingRemote = false
    }
  }

  /** The watch runs while a branch of a repository is in scope; one timer, never two. */
  const syncRemoteWatch = (): void => {
    const isWatchable = data.disabled === null && data.context?.branch != null
    if (!isWatchable) {
      remoteTimer?.cancel()
      remoteTimer = null
      tracked = null
      return
    }
    remoteTimer ??= ports.every(REMOTE_WATCH_MS, () => void watchRemote(false).catch(fail('remote')))
    // The baseline for this poll's branch, and its push target read afresh.
    void watchRemote(true).catch(fail('remote'))
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

  /** gh's own pick when git names no GitHub repo: it costs a request, so kept for the cwd until it moves. */
  const repoViaGh = async (cwd: string): Promise<GhResult<string>> => {
    if (ghRepo?.cwd === cwd) return { kind: 'ok', value: ghRepo.repo }
    const asked = await repoName(ports.run, cwd)
    if (asked.kind === 'ok') ghRepo = { cwd, repo: asked.value }
    return asked
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
    // Git's remotes are read every poll (cheap, local), so a branch switch to another push remote moves the pane.
    const fromGit = await repoFromRemotes(ports.run, cwd, head.branch)
    const repo: GhResult<string> = fromGit !== null ? { kind: 'ok', value: fromGit } : await repoViaGh(cwd)
    if (repo.kind !== 'ok') {
      await onFailure(repo)
      return null
    }
    return { cwd, branch: head.branch, sha: head.sha, repo: repo.value }
  }

  const detail = async (cwd: string, repo: string, now: number): Promise<void> => {
    // A re-run makes a finished run active again: read it afresh when it finishes again.
    const active = new Set(data.runs.filter(run => isActiveStatus(run.status)).map(run => run.id))
    final = new Set([...final].filter(id => !active.has(id)))
    const wanted = runsToDetail(data, (await snapshotAt(now)).shownIds, final)
    const answers = await Promise.all(wanted.map(async id => [id, await viewJobs(ports.run, cwd, repo, id)] as const))
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

  /** Past durations of the active runs' workflows, for the ETA: not while rate limited; a failed read is retried next poll. */
  const readHistory = async (cwd: string, repo: string): Promise<void> => {
    if (data.isRateLimited) return
    const answers = await Promise.all(workflowsToRead(data).map(async id => [id, await listDurations(ports.run, cwd, repo, id)] as const))
    const read = new Map<number, number[]>()
    for (const [id, answer] of answers) {
      if (answer.kind === 'ok') read.set(id, answer.value)
      else await onFailure(answer)
    }
    await publish(withHistory(data, read))
  }

  /** A push (or a command that starts runs): poll now and at the active rate for a while. */
  const kick = async (): Promise<void> => {
    lastKickAt = await ports.now()
    kickUntil = lastKickAt + KICK_MS
    await poll()
  }

  const pollOnce = async (): Promise<void> => {
    const cwd = await ports.cwd()
    const now = await ports.now()
    if (cwd !== lastCwd) final = new Set()
    lastCwd = cwd
    const context = await readContext(cwd)
    if (context !== null) {
      const filter = listFilter(await scopeNow(), context)
      const listed: GhResult<ActionsData['runs']> = filter === null ? { kind: 'ok', value: [] } : await listRuns(ports.run, cwd, context.repo, filter)
      // Another repository: nothing of the last one carries over, whatever the list says.
      const isNewRepo = data.context !== null && data.context.repo !== context.repo
      if (isNewRepo) final = new Set()
      await publish({ ...(isNewRepo ? EMPTY_DATA : data), context, disabled: null })
      if (listed.kind === 'ok') await publish(withRuns(data, listed.value, now))
      else await onFailure(listed)
      // The band shows from here, while history and job reads are still out: tick now.
      if (tickTimer === null && data.runs.some(run => isActiveStatus(run.status))) await syncTick(await ports.now(), true)
      await publish({ ...data, pollMs: intervalAt(now) })
      if (data.disabled === null) await readHistory(cwd, context.repo)
      // A rate limit met by the history read stops this poll's job reads too.
      if (data.disabled === null && !data.isRateLimited) await detail(cwd, context.repo, now)
    }
    const settled = await ports.now()
    await step(snapshot => ({ kind: 'poll', view: viewOf(snapshot), autoOpen: settings.autoOpen }), settled)
    schedule(settled)
    syncRemoteWatch()
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
      data = restoredData(await ports.data.get())
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
    kick,
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
      await refresh(now)
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
      await ports.manual.set(false)
      await refresh(now)
    },
    /** A /clear emptied the session's state: put back what the pane draws from. */
    republish: async (): Promise<void> => {
      await ports.data.set(data)
      await ports.manual.set(lifecycle.mode === 'manual')
      await ports.clock.set(await ports.now())
    },
    stop: (): void => {
      pollTimer?.cancel()
      remoteTimer?.cancel()
      stopTick()
    },
  }
}

export type Runtime = ReturnType<typeof createRuntime>
