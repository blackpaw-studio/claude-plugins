import { describe, expect, test } from 'claude-code/testing'
import type { ActionsData, ActionsJob, ActionsRun } from '../types'
import { fail, ok } from './testing/runner'
import { createRuntime, REMOTE_WATCH_MS } from './runtime'
import { DEFAULT_SETTINGS, type Settings } from './settings'
import { dataOf, ghJobs, ghRun, jobOf, runOf, SECOND, T0 } from './testing/builders'
import { fakeWorld, type FakeWorld, flush, SHA } from './testing/ports'

const LIST = 'gh run list'
const HEAD = 'git rev-parse HEAD --abbrev-ref HEAD'
const FORK_CONFIG = [
  'remote.upstream.url=https://github.com/ghostty-org/ghostty.git',
  'remote.origin.url=git@github.com:blackpaw-studio/leoterm.git',
  'branch.main.remote=origin',
].join('\n')
const runsAre = (world: FakeWorld, runs: readonly ActionsRun[]) => world.answers.set(LIST, ok(JSON.stringify(runs.map(ghRun))))
const jobsAre = (world: FakeWorld, id: number, jobs: readonly ActionsJob[]) =>
  world.answers.set(`gh run view ${id} --repo`, ok(JSON.stringify(ghJobs(jobs))))

const RUNNING = runOf({ id: 482, createdAt: T0, startedAt: T0 })
const PASSED = { ...RUNNING, status: 'completed', conclusion: 'success', updatedAt: T0 + 90 * SECOND }
const TEST_JOB = jobOf('test', { status: 'in_progress', conclusion: null, completedAt: null })

const setup = (settings: Settings = DEFAULT_SETTINGS) => {
  const world = fakeWorld(T0)
  const runtime = createRuntime(world.ports, settings)
  return { world, runtime }
}

const gh = (world: FakeWorld) => world.asked.filter(argv => argv.startsWith('gh'))
/** Branch scope lists twice per poll (by branch, by HEAD's commit): count polls by the branch list. */
const pollsOf = (world: FakeWorld) => gh(world).filter(argv => argv.startsWith(LIST) && argv.includes('--branch ')).length

describe('watching a run', () => {
  test('a poll that sees a run starts the pane, reads its jobs, and polls at the active rate', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    expect(gh(world)).toEqual([
      'gh repo view --json nameWithOwner',
      expect.stringMatching(/^gh run list --repo acme\/widgets --limit 20 --json \S+ --branch main$/),
      expect.stringMatching(/^gh run list --repo acme\/widgets --limit 20 --json \S+ --commit a1b2c3d4e5f60718293a4b5c6d7e8f9012345678$/),
      'gh run list --repo acme/widgets --workflow 1234 --status success --limit 10 --json startedAt,createdAt,updatedAt,conclusion',
      'gh run view 482 --repo acme/widgets --json jobs',
    ])
    expect(world.opens()).toBe(1)
    expect(world.data()?.jobs['482']?.map(job => job.name)).toEqual(['test'])
    expect(world.data()?.watched).toEqual({ 482: null })
    // The poll (10s) and the 1s tick.
    expect(world.waiting()).toEqual([1000, REMOTE_WATCH_MS, 10_000])
  })

  test('an auto-open draws at the moment it opens, not at a stale clock', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    expect(world.drawnNow()).toBe(T0)
  })

  test('the tick moves the drawn clock each second while the pane is open', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    await world.advance(3 * SECOND)
    expect(world.drawnNow()).toBe(T0 + 3 * SECOND)
  })

  test('finish, linger 30s, close; the finished run is read once more, then cached', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    runsAre(world, [PASSED])
    jobsAre(world, 482, [jobOf('test')])
    await world.advance(10 * SECOND)
    expect(world.data()?.watched).toEqual({ 482: T0 + 10 * SECOND })
    expect(world.data()?.jobs['482']?.[0]?.status).toBe('completed')
    expect(world.closes()).toBe(0)
    const views = () => gh(world).filter(argv => argv.startsWith('gh run view')).length
    const viewsAtFinish = views()
    await world.advance(29 * SECOND)
    expect(world.closes()).toBe(0)
    await world.advance(SECOND)
    expect(world.closes()).toBe(1)
    expect(views()).toBe(viewsAtFinish)
    // Closed: no tick; the poll goes back to the idle rate; the push watch goes on.
    expect(world.waiting()).toEqual([REMOTE_WATCH_MS, expect.any(Number)])
    await world.advance(60 * SECOND)
    expect(world.opens()).toBe(1)
  })

  test('jobs all done while GitHub says the run is active: the pane stays open past the linger', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    // The first stage finished; the next has not been created yet.
    jobsAre(world, 482, [jobOf('test', { completedAt: T0 + 8 * SECOND })])
    await world.advance(90 * SECOND)
    expect(world.closes()).toBe(0)
    expect(world.statuses.at(-1)).toBe(undefined)
  })

  test('a re-run of a finished run has its jobs read again when it finishes again', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    runsAre(world, [PASSED])
    jobsAre(world, 482, [jobOf('test')])
    await world.advance(10 * SECOND)
    // Nothing active: the re-run is seen at the idle rate.
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await world.advance(60 * SECOND)
    expect(world.data()?.jobs['482']?.[0]?.status).toBe('in_progress')
    runsAre(world, [PASSED])
    jobsAre(world, 482, [jobOf('test')])
    await world.advance(10 * SECOND)
    expect(world.data()?.jobs['482']?.[0]?.status).toBe('completed')
  })

  test('autoOpen off: never opens, the status line says what runs', async () => {
    const { world, runtime } = setup({ ...DEFAULT_SETTINGS, autoOpen: false })
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    expect(world.opens()).toBe(0)
    expect(world.statuses.at(-1)).toBe('◐ 1 running')
  })
})

describe('a pane that cannot seat', () => {
  test('shows the status line instead, and clears it once the pane seats', async () => {
    const { world, runtime } = setup()
    world.setPlaced(false)
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    expect(world.statuses.at(-1)).toBe('◐ 1 running')
    world.setPane({ isOpen: true, isPlaced: true })
    await world.advance(SECOND)
    expect(world.statuses.at(-1)).toBe(undefined)
  })

  test('/actions seats a pane that waits unseated (asked), rather than closing it', async () => {
    const { world, runtime } = setup()
    world.setPlaced(false)
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    let asked = 0
    const reply = await runtime.toggle(async () => {
      asked += 1
      world.setPane({ isOpen: true, isPlaced: true })
      return { isPlaced: true }
    })
    expect(reply.text).toBe('Actions pane opened.')
    expect([asked, world.closes()]).toEqual([1, 0])
    expect(world.manual()).toBe(true)
    expect(world.statuses.at(-1)).toBe(undefined)
  })

  test('a failure shows in the status line while unseated, and clears on close', async () => {
    const { world, runtime } = setup()
    world.setPlaced(false)
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    runsAre(world, [{ ...RUNNING, status: 'completed', conclusion: 'failure' }])
    await world.advance(10 * SECOND)
    expect(world.statuses.at(-1)).toBe('✗ 1 failed')
    await world.advance(30 * SECOND)
    expect(world.closes()).toBe(1)
    expect(world.statuses.at(-1)).toBe(undefined)
  })
})

describe('rate limits and failures', () => {
  test('a rate limit backs off to the idle rate and says so; a good list clears it', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    world.answers.set(LIST, fail('HTTP 403: API rate limit exceeded for user ID 1.'))
    await world.advance(10 * SECOND)
    expect(world.data()?.isRateLimited).toBe(true)
    expect(world.data()?.runs.map(run => run.id)).toEqual([482])
    expect(world.waiting()).toContain(60_000)
    runsAre(world, [RUNNING])
    await world.advance(60 * SECOND)
    expect(world.data()?.isRateLimited).toBe(false)
  })

  test('a transient gh failure keeps the last data', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    const fetchedAt = world.data()?.fetchedAt
    world.answers.set(LIST, fail('error connecting to api.github.com'))
    await world.advance(10 * SECOND)
    expect(world.data()?.fetchedAt).toBe(fetchedAt)
    expect(world.data()?.runs.length).toBe(1)
  })
})

describe('when there is nothing to watch', () => {
  test('outside a repository: disabled, gh never asked, no timer', async () => {
    const { world, runtime } = setup()
    world.answers.set(HEAD, fail('fatal: not a git repository (or any of the parent directories): .git', 128))
    await runtime.start()
    expect(world.data()?.disabled).toBe('not a git repository')
    expect(gh(world)).toEqual([])
    expect(world.waiting()).toEqual([])
  })

  test('a move into a repository starts watching again', async () => {
    const { world, runtime } = setup()
    world.answers.set(HEAD, fail('fatal: not a git repository', 128))
    await runtime.start()
    world.answers.set(HEAD, ok('a1b2c3d\nmain\n'))
    await runtime.cwdMaybeChanged()
    expect(gh(world)).toEqual([])
    world.setCwd('/elsewhere')
    await runtime.cwdMaybeChanged()
    expect(world.data()?.disabled).toBe(null)
    expect(world.waiting()).toEqual([REMOTE_WATCH_MS, 60_000])
  })

  test('a move to another repository drops the runs of the last, even when its list fails', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    world.setCwd('/other')
    world.answers.set('gh repo view', ok('{"nameWithOwner":"acme/other"}'))
    world.answers.set(LIST, fail('error connecting to api.github.com'))
    await runtime.cwdMaybeChanged()
    expect(world.data()?.context?.repo).toBe('acme/other')
    expect([world.data()?.runs, world.data()?.jobs, world.data()?.watched]).toEqual([[], {}, {}])
  })

  test('a fork clone watches its own remote, not the upstream gh would pick, and never asks gh', async () => {
    const { world, runtime } = setup()
    world.answers.set('git config --list', ok(FORK_CONFIG))
    world.answers.set('gh repo view', ok('{"nameWithOwner":"ghostty-org/ghostty"}'))
    await runtime.start()
    expect(world.data()?.context?.repo).toBe('blackpaw-studio/leoterm')
    expect(gh(world).filter(argv => argv.startsWith('gh repo'))).toEqual([])
  })

  test('every gh run command is pinned to the resolved repo, so a fork never reads the upstream\'s runs', async () => {
    const { world, runtime } = setup()
    world.answers.set('git config --list', ok(FORK_CONFIG))
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    const runCommands = gh(world).filter(argv => argv.startsWith('gh run'))
    expect(runCommands.length).toBeGreaterThanOrEqual(3)
    expect(runCommands.filter(argv => !argv.includes(' --repo blackpaw-studio/leoterm '))).toEqual([])
  })

  test('a branch switch to another push remote moves the pane to that repo and drops the last one', async () => {
    const { world, runtime } = setup()
    world.answers.set('git config --list', ok(`${FORK_CONFIG}\nremote.mine.url=git@github.com:evan/leoterm.git\nbranch.feat/x.pushremote=mine`))
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    expect(world.data()?.context?.repo).toBe('blackpaw-studio/leoterm')
    world.answers.set(HEAD, ok(`${SHA}\nfeat/x\n`))
    world.answers.set(LIST, ok('[]'))
    await runtime.poll()
    expect(world.data()?.context?.repo).toBe('evan/leoterm')
    expect(world.data()?.runs).toEqual([])
  })

  test('without a GitHub remote in git, gh is asked once and its answer kept until the cwd moves', async () => {
    const { world, runtime } = setup()
    world.answers.set('git config --list', ok('remote.corp.url=git@git.corp.example:team/app.git'))
    await runtime.start()
    await runtime.poll()
    expect(world.data()?.context?.repo).toBe('acme/widgets')
    expect(gh(world).filter(argv => argv.startsWith('gh repo'))).toEqual(['gh repo view --json nameWithOwner'])
  })

  test('/actions says why, and does not open', async () => {
    const { world, runtime } = setup()
    world.answers.set('gh repo view', fail('To get started with GitHub CLI, please run:  gh auth login', 4))
    await runtime.start()
    const reply = await runtime.toggle(async () => ({ isPlaced: true }))
    expect(reply.text).toBe('Actions pane: gh is not logged in (run gh auth login).')
  })
})

describe('pushes from outside Claude', () => {
  const MAIN_REF = 'git rev-parse --verify -q refs/remotes/origin/main'
  const lists = pollsOf
  const pushed = (world: FakeWorld, sha = 'b'.repeat(40)) => world.answers.set(MAIN_REF, ok(`${sha}\n`))

  test('a moved tracking ref polls within 5s and holds the active rate for two minutes', async () => {
    const { world, runtime } = setup()
    await runtime.start()
    expect(lists(world)).toBe(1)
    await world.advance(3 * SECOND)
    pushed(world)
    await world.advance(2 * SECOND)
    expect(lists(world)).toBe(2)
    // Active rate from here: a poll every 10s until the kick lapses (a push at +3s, seen at +5s).
    await world.advance(30 * SECOND)
    expect(lists(world)).toBe(5)
    await world.advance(100 * SECOND)
    expect(lists(world)).toBe(14)
    await world.advance(30 * SECOND)
    expect(lists(world)).toBe(14)
  })

  test('a push through Claude is polled once, not again when the ref is seen to move', async () => {
    const { world, runtime } = setup()
    await runtime.start()
    pushed(world)
    await runtime.kick()
    expect(lists(world)).toBe(2)
    await world.advance(5 * SECOND)
    expect(lists(world)).toBe(2)
  })

  test('nothing moving: no gh calls beyond the idle poll', async () => {
    const { world, runtime } = setup()
    await runtime.start()
    await world.advance(55 * SECOND)
    expect(lists(world)).toBe(1)
    await world.advance(5 * SECOND)
    expect(lists(world)).toBe(2)
  })

  test('the first read is a baseline, not a push', async () => {
    const { world, runtime } = setup()
    pushed(world, 'c'.repeat(40))
    await runtime.start()
    await world.advance(10 * SECOND)
    expect(lists(world)).toBe(1)
  })

  test('the first push of a new branch creates the ref and counts', async () => {
    const { world, runtime } = setup()
    world.answers.set(MAIN_REF, fail('', 1))
    await runtime.start()
    await world.advance(5 * SECOND)
    expect(lists(world)).toBe(1)
    pushed(world)
    await world.advance(5 * SECOND)
    expect(lists(world)).toBe(2)
  })

  test('a git that cannot answer is not a push', async () => {
    const { world, runtime } = setup()
    await runtime.start()
    world.answers.set(MAIN_REF, fail('fatal: bad object', 128))
    await world.advance(10 * SECOND)
    pushed(world, SHA)
    await world.advance(10 * SECOND)
    expect(lists(world)).toBe(1)
  })

  test('another branch is a new baseline, not a push', async () => {
    const { world, runtime } = setup()
    await runtime.start()
    world.answers.set(HEAD, ok(`${SHA}\nfeature\n`))
    world.answers.set('git rev-parse --symbolic-full-name @{push}', fail('fatal: no upstream', 128))
    world.answers.set('git rev-parse --verify -q refs/remotes/origin/feature', ok(`${'d'.repeat(40)}\n`))
    await runtime.poll()
    const listed = lists(world)
    await world.advance(10 * SECOND)
    expect(lists(world)).toBe(listed)
    world.answers.set('git rev-parse --verify -q refs/remotes/origin/feature', ok(`${'e'.repeat(40)}\n`))
    await world.advance(5 * SECOND)
    expect(lists(world)).toBe(listed + 1)
  })

  test('the first push -u of a new branch to another remote is seen and watched from then on', async () => {
    const { world, runtime } = setup()
    // A new branch: no push target yet, so origin's ref is watched.
    world.answers.set('git rev-parse --symbolic-full-name @{push}', fail('fatal: no upstream', 128))
    await runtime.start()
    await world.advance(10 * SECOND)
    expect(lists(world)).toBe(1)
    // git push -u fork main: the upstream is set and fork's ref appears; origin's does not move.
    world.answers.set('git rev-parse --symbolic-full-name @{push}', ok('refs/remotes/fork/main\n'))
    world.answers.set('git rev-parse --verify -q refs/remotes/fork/main', ok(`${'f'.repeat(40)}\n`))
    await world.advance(5 * SECOND)
    expect(lists(world)).toBe(2)
    // Once the kick has lapsed, fork's ref moving is what kicks.
    await world.advance(125 * SECOND)
    const listed = lists(world)
    world.answers.set('git rev-parse --verify -q refs/remotes/fork/main', ok(`${'9'.repeat(40)}\n`))
    await world.advance(5 * SECOND)
    expect(lists(world)).toBe(listed + 1)
  })

  test('a push target changed in config is re-read on the next poll, then watched', async () => {
    const { world, runtime } = setup()
    await runtime.start()
    world.answers.set('git rev-parse --symbolic-full-name @{push}', ok('refs/remotes/fork/main\n'))
    world.answers.set('git rev-parse --verify -q refs/remotes/fork/main', ok(`${'f'.repeat(40)}\n`))
    await world.advance(5 * SECOND)
    await runtime.poll()
    const listed = lists(world)
    await world.advance(5 * SECOND)
    expect(lists(world)).toBe(listed)
    world.answers.set('git rev-parse --verify -q refs/remotes/fork/main', ok(`${'9'.repeat(40)}\n`))
    await world.advance(5 * SECOND)
    expect(lists(world)).toBe(listed + 1)
  })

  test('one watch timer however many polls and reloads of state', async () => {
    const { world, runtime } = setup()
    await runtime.start()
    await runtime.poll()
    await runtime.poll()
    await runtime.republish()
    const before = world.asked.filter(argv => argv === MAIN_REF).length
    await world.advance(10 * SECOND)
    expect(world.asked.filter(argv => argv === MAIN_REF).length - before).toBe(2)
  })

  test('without a repository the watch stops, and starts again in one', async () => {
    const { world, runtime } = setup()
    await runtime.start()
    world.answers.set(HEAD, fail('fatal: not a git repository', 128))
    await runtime.poll()
    const asked = world.asked.length
    await world.advance(20 * SECOND)
    expect(world.asked.length).toBe(asked)
    world.answers.set(HEAD, ok(`${SHA}\nmain\n`))
    await runtime.poll()
    await world.advance(5 * SECOND)
    expect(world.asked.filter(argv => argv === MAIN_REF).length).toBeGreaterThan(1)
  })

  test('a detached HEAD has no branch to watch', async () => {
    const { world, runtime } = setup()
    world.answers.set(HEAD, ok(`${SHA}\nHEAD\n`))
    await runtime.start()
    await world.advance(20 * SECOND)
    expect(world.asked.filter(argv => argv === MAIN_REF)).toEqual([])
  })
})

describe('kicks and toggles', () => {
  test('a push polls at once, then at the active rate for two minutes', async () => {
    const { world, runtime } = setup()
    await runtime.start()
    expect(world.waiting()).toEqual([REMOTE_WATCH_MS, 60_000])
    await world.advance(5 * SECOND)
    await runtime.kick()
    expect(pollsOf(world)).toBe(2)
    expect(world.waiting()).toEqual([REMOTE_WATCH_MS, 10_000])
    await world.advance(120 * SECOND)
    expect(world.waiting()).toEqual([REMOTE_WATCH_MS, 60_000])
  })

  test('/actions opens by hand (asked), stays past the linger, closes on the second /actions', async () => {
    const { world, runtime } = setup()
    runsAre(world, [PASSED])
    await runtime.start()
    let asked = 0
    const reply = await runtime.toggle(async () => {
      asked += 1
      world.setPane({ isOpen: true, isPlaced: true })
      return { isPlaced: true }
    })
    await flush()
    expect(reply.text).toBe('Actions pane opened.')
    expect([asked, world.opens()]).toEqual([1, 0])
    expect(world.manual()).toBe(true)
    // Opened by hand with nothing active: the latest run is shown, its jobs read.
    expect(gh(world)).toContain('gh run view 482 --repo acme/widgets --json jobs')
    await world.advance(120 * SECOND)
    expect(world.closes()).toBe(0)
    expect((await runtime.toggle(async () => ({ isPlaced: true }))).text).toBe('Actions pane closed.')
    expect(world.closes()).toBe(1)
    expect(world.manual()).toBe(false)
  })

  test('closed by the person while a run is going: stays closed until a new run', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    await runtime.closedByPerson()
    await world.advance(10 * SECOND)
    expect(world.opens()).toBe(1)
    const next = runOf({ id: 483, createdAt: T0 + 15 * SECOND })
    runsAre(world, [next, RUNNING])
    jobsAre(world, 483, [])
    await world.advance(10 * SECOND)
    expect(world.opens()).toBe(2)
  })

  test('/actions repo switches scope for the session and polls', async () => {
    const { world, runtime } = setup()
    await runtime.start()
    const reply = await runtime.setScope('repo')
    expect(reply.text).toBe('Actions pane scope: repo (this session).')
    expect(gh(world).filter(argv => argv.startsWith(LIST)).at(-1)).toMatch(/--json \S+$/)
  })
})

describe('reload and /clear', () => {
  test('start picks up the watched runs a reload left in state, and an open pane', async () => {
    const { world } = setup()
    const first = createRuntime(world.ports, DEFAULT_SETTINGS)
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await first.start()
    first.stop()
    const second = createRuntime(world.ports, DEFAULT_SETTINGS)
    runsAre(world, [PASSED])
    await second.start()
    // Seen active before the reload: it lingers rather than vanishing.
    expect(world.data()?.watched).toEqual({ 482: T0 })
    expect(world.opens()).toBe(1)
    expect(world.waiting()).toContain(1000)
  })

  test('republish puts the data back after /clear empties state', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    await runtime.start()
    const held = world.data()
    await world.ports.data.set(null as never)
    await runtime.republish()
    expect(world.data()).toEqual(held)
  })
})

describe('run ETA history', () => {
  const HISTORY = 'gh run list --repo acme/widgets --workflow'
  const durations = (...seconds: number[]) =>
    ok(JSON.stringify(seconds.map(s => ({ conclusion: 'success', createdAt: '2026-10-09T17:00:00Z', startedAt: '2026-10-09T17:00:00Z', updatedAt: new Date(Date.parse('2026-10-09T17:00:00Z') + s * SECOND).toISOString() }))))
  const historyCalls = (world: FakeWorld) => gh(world).filter(argv => argv.includes('--workflow '))
  const historyIs = (world: FakeWorld, id: number, ...seconds: number[]) => world.answers.set(`${HISTORY} ${id} `, durations(...seconds))
  const started = async () => {
    const harness = setup()
    runsAre(harness.world, [RUNNING])
    jobsAre(harness.world, 482, [TEST_JOB])
    historyIs(harness.world, 1234, 100, 120, 140)
    await harness.runtime.start()
    return harness
  }

  test('reads the workflow\'s last ten successes by id once the run is seen, and keeps the durations', async () => {
    const { world } = await started()
    expect(historyCalls(world)).toEqual([
      'gh run list --repo acme/widgets --workflow 1234 --status success --limit 10 --json startedAt,createdAt,updatedAt,conclusion',
    ])
    expect(world.data()?.history).toEqual({ '1234': [100_000, 120_000, 140_000] })
  })

  test('one call per distinct workflow among the active runs', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING, runOf({ id: 483, number: 483, workflowId: 1234 }), runOf({ id: 484, number: 12, workflowId: 77, workflow: 'Deploy' })])
    jobsAre(world, 482, [TEST_JOB])
    jobsAre(world, 483, [TEST_JOB])
    jobsAre(world, 484, [TEST_JOB])
    await runtime.start()
    expect(historyCalls(world).map(argv => argv.split(' ')[6])).toEqual(['1234', '77'])
  })

  test('polls that follow, idle or not, do not read it again', async () => {
    const { world } = await started()
    await world.advance(60 * SECOND)
    expect(historyCalls(world)).toHaveLength(1)
  })

  test('a run finishing drops the workflow\'s history; the next run of it reads afresh, with the finished one a sample', async () => {
    const { world } = await started()
    runsAre(world, [PASSED])
    jobsAre(world, 482, [jobOf('test')])
    await world.advance(10 * SECOND)
    expect(world.data()?.history).toEqual({})
    expect(historyCalls(world)).toHaveLength(1)
    historyIs(world, 1234, 90, 100, 120, 140)
    runsAre(world, [PASSED, runOf({ id: 483, number: 483, createdAt: T0 + 70 * SECOND, startedAt: T0 + 70 * SECOND })])
    jobsAre(world, 483, [TEST_JOB])
    await world.advance(60 * SECOND)
    expect(historyCalls(world)).toHaveLength(2)
    expect(world.data()?.history).toEqual({ '1234': [90_000, 100_000, 120_000, 140_000] })
  })

  test('a failed read leaves no history, the pane carries on, and a later poll tries again', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    world.answers.set(`${HISTORY} 1234 `, fail('HTTP 502'))
    await runtime.start()
    expect(world.data()?.history).toEqual({})
    expect(world.data()?.disabled).toBe(null)
    expect(world.opens()).toBe(1)
    historyIs(world, 1234, 100, 120, 140)
    await world.advance(10 * SECOND)
    expect(historyCalls(world)).toHaveLength(2)
    expect(world.data()?.history).toEqual({ '1234': [100_000, 120_000, 140_000] })
  })

  test('none is read while rate limited; read once the limit lifts', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    world.answers.set(`${HISTORY} 1234 `, fail('HTTP 502'))
    await runtime.start()
    world.answers.set(LIST, fail('API rate limit exceeded'))
    historyIs(world, 1234, 100, 120, 140)
    await world.advance(30 * SECOND)
    expect(world.data()?.isRateLimited).toBe(true)
    expect(historyCalls(world)).toHaveLength(1)
    runsAre(world, [RUNNING])
    await world.advance(60 * SECOND)
    expect(world.data()?.isRateLimited).toBe(false)
    expect(world.data()?.history).toEqual({ '1234': [100_000, 120_000, 140_000] })
  })

  test('state saved by 0.1.2, with no history, starts and polls like fresh state', async () => {
    const { world, runtime } = setup()
    const { history: _history, ...legacy } = dataOf({ runs: [{ ...RUNNING, workflowId: undefined as unknown as null }] })
    await world.ports.data.set(legacy as unknown as ActionsData)
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    historyIs(world, 1234, 100, 120, 140)
    await runtime.start()
    expect(world.data()?.history).toEqual({ '1234': [100_000, 120_000, 140_000] })
    expect(world.waiting()).toContain(10_000)
  })

  test('a rate limit on the read itself marks the pane rate limited and leaves no history', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    world.answers.set(`${HISTORY} 1234 `, fail('API rate limit exceeded'))
    await runtime.start()
    expect(world.data()?.isRateLimited).toBe(true)
    expect(world.data()?.history).toEqual({})
  })

  test('no job requests follow a rate-limited history response', async () => {
    const { world, runtime } = setup()
    runsAre(world, [RUNNING])
    jobsAre(world, 482, [TEST_JOB])
    world.answers.set(`${HISTORY} 1234 `, fail('API rate limit exceeded'))
    await runtime.start()
    expect(gh(world).filter(argv => argv.startsWith('gh run view'))).toEqual([])
  })
})
