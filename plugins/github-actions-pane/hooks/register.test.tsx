import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { ghJobs, ghRun, jobOf, runOf, SECOND, stepOf, T0 } from '../src/testing/builders'

const PLUGIN = 'github-actions-pane'
const ENGINE_HINT = '⏵⏵ accept edits on (shift+tab to cycle)'
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

const RUN = runOf({ id: 482, createdAt: T0, startedAt: T0 })
const JOBS = [
  jobOf('lint', { id: 1 }),
  jobOf('test (node 20)', {
    id: 2,
    status: 'in_progress',
    conclusion: null,
    completedAt: null,
    steps: [
      stepOf('Set up job', { number: 1 }),
      stepOf('Run tests', { number: 2, status: 'in_progress', conclusion: null, completedAt: null }),
    ],
  }),
]

type World = {
  argvs: string[]
  opens: { id: string; title?: string }[]
  registered: string[]
  statuses: (string | undefined)[]
  clock: ReturnType<typeof mock.clock>
  setRepo: (isRepo: boolean) => void
}

const done = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

/** The session beneath the plugin: a repo on main with one run in flight. */
const installWorld = (on: On): World => {
  const argvs: string[] = []
  const opens: { id: string; title?: string }[] = []
  const statuses: (string | undefined)[] = []
  const registered: string[] = []
  let isRepo = true
  let isOpen = false
  const clock = mock.clock(on, { now: T0 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.cwd', () => ({ value: '/r' }))
  on('command.register', (_$, e) => ((registered.push(e.name), { value: { command: e.name } })))
  on('ui.log', () => ({ value: undefined }))
  on('ui.status', (_$, e) => ((statuses.push(e.text), { value: undefined })))
  on('ui.open', (_$, e) => {
    opens.push({ id: e.id, ...(e.title === undefined ? {} : { title: e.title }) })
    isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ((isOpen = false), { value: undefined }))
  on('ui.panes', () => ({
    value: isOpen ? [{ id: 'actions', title: 'Actions', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('process.run', (_$, e) => {
    const command = e.argv.join(' ')
    argvs.push(command)
    const answer = (stdout: string, exitCode = 0, stderr = '') => ({ value: { ...done, exitCode, stdout, stderr } })
    if (e.argv[0] === 'git') return isRepo ? answer(`${SHA}\nmain\n`) : answer('', 128, 'fatal: not a git repository')
    if (command.startsWith('gh repo view')) return answer('{"nameWithOwner":"acme/widgets"}')
    if (command.startsWith('gh run list')) return answer(JSON.stringify([ghRun(RUN)]))
    if (command === 'gh run view 482 --repo acme/widgets --json jobs') return answer(JSON.stringify(ghJobs(JOBS)))
    if (command === 'gh run view 482 --repo acme/widgets --web') return answer('')
    return answer('', 1, `unexpected: ${command}`)
  })
  // The engine's line, as the terminal draws it: the hint, then the hook's tail.
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return (
      <Text>
        {e.props.hint}
        {e.props.tail === undefined ? null : `|tail:${e.props.tail}`}
      </Text>
    )
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  return { argvs, opens, registered, statuses, clock, setRepo: value => void (isRepo = value) }
}

const startSession = async ($: Engine, world: World) => {
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await world.clock.settle()
}

const PANE_PROPS = {
  title: 'Actions',
  isFocused: false,
  bodyColumns: 45,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'actions', props: PANE_PROPS, viewport: { columns: 140, rows: 40, isFullscreen: true } })

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const textOfNode = (node: unknown): string =>
  typeof node === 'string' ? node : ((node as Node | null)?.children ?? []).map(textOfNode).join('')
const findNode = (node: unknown, type: string): Node | undefined => {
  if (typeof node !== 'object' || node === null) return undefined
  const { type: kind, children = [] } = node as Node
  return kind === type ? (node as Node) : children.map(child => findNode(child, type)).find(found => found !== undefined)
}

const HINT_PROPS = { isDraft: false, isWorking: false, hint: ENGINE_HINT }

const mountHint = ($: Engine, props: Record<string, unknown> = HINT_PROPS, surface: 'terminal' | 'desktop' = 'terminal', columns = 100) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'PromptHint', props, viewport: { columns, rows: 40 } })

const command = (args: string) => ({
  command: 'actions',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 140 },
})

describe('github-actions-pane in a session', () => {
  test('with autoOpen on, a run in flight opens the pane, drawn as the run view', { options: { autoOpen: true } }, async ($, on) => {
    const world = installWorld(on)
    await startSession($, world)
    expect(world.opens).toEqual([{ id: 'actions', title: 'Actions' }])
    await world.clock.advance(3 * SECOND)
    const tree = await (await mountPane($)).drawn()
    const rows = ((tree as Node).children ?? []).map(textOfNode)
    expect(rows).toEqual([
      'GitHub Actions · main',
      ' ',
      '◐ CI #482 · push                         3s',
      '  fix: parser edge case · a1b2c3d',
      '  ✓ lint                                18s',
      '  ◐ test (node 20)                       3s',
      '    ✓ Set up job                         1s',
      `    ${'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[(Math.floor(T0 / 1000) + 3) % 10]} Run tests                          3s`,
    ])
    expect(findNode(tree, 'Button')?.props).toMatchObject({ plain: true, key: 'open:482' })
    await $.ui.press({ plugin: PLUGIN, key: 'open:482' })
    expect(world.argvs.at(-1)).toBe('gh run view 482 --repo acme/widgets --web')
  })

  test('/actions outside a repository answers why', async ($, on) => {
    const world = installWorld(on)
    world.setRepo(false)
    await startSession($, world)
    expect(world.opens).toEqual([])
    expect(await $.command.run(command(''))).toEqual({ text: 'Actions pane: not a git repository.' })
    expect(await $.command.run(command('everything'))).toEqual({ text: 'Usage: /actions [commit|branch|repo]' })
  })

  test('/actions toggles quietly; /actions repo sets the scope', async ($, on) => {
    const world = installWorld(on)
    await startSession($, world)
    expect(await $.command.run(command(''))).toEqual({})
    expect(await $.command.run(command('repo'))).toEqual({ text: 'Actions pane scope: repo (this session).' })
    expect(world.argvs.filter(argv => argv.startsWith('gh run list')).at(-1)).not.toContain('--branch')
  })

  test('a git push through Bash polls at once', async ($, on) => {
    const world = installWorld(on)
    await startSession($, world)
    // Branch scope lists twice per poll (branch, HEAD's commit): count the branch list.
    const lists = () => world.argvs.filter(argv => argv.startsWith('gh run list') && argv.includes('--branch ')).length
    const before = lists()
    await $.tool.call({ tool: 'Bash', command: 'git push -u origin main' } as never)
    await world.clock.settle()
    expect(lists()).toBe(before + 1)
    await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
    await world.clock.settle()
    expect(lists()).toBe(before + 1)
  })

  test('/actions is registered again after a /clear (a new session, no session.start)', async ($, on) => {
    const world = installWorld(on)
    await startSession($, world)
    await $.session.end({ reason: 'clear', sessionId: 'cleared', resume: { id: 'cleared' } })
    await world.clock.settle()
    expect(world.registered).toEqual(['actions', 'actions'])
  })

  test('autoOpen defaults off: a run in flight opens no pane', async ($, on) => {
    const world = installWorld(on)
    await startSession($, world)
    await world.clock.advance(3 * SECOND)
    expect(world.opens).toEqual([])
  })
})

describe('the actions text on the footer hint line', () => {
  test('a run in flight adds a counting tail; the engine hint stays whole', async ($, on) => {
    const world = installWorld(on)
    await startSession($, world)
    const hint = await mountHint($)
    expect(textOfNode(await hint.drawn())).toBe(`${ENGINE_HINT}|tail:  ⟳ 1 running · 0s`)
    await world.clock.advance(3 * SECOND)
    expect(textOfNode(await hint.drawn())).toBe(`${ENGINE_HINT}|tail:  ⟳ 1 running · 3s`)
    expect(world.opens).toEqual([])
  })

  test('a tail another hook set is kept, ours follows it', async ($, on) => {
    const world = installWorld(on)
    await startSession($, world)
    const hint = await mountHint($, { ...HINT_PROPS, tail: '5h 40%' })
    expect(textOfNode(await hint.drawn())).toBe(`${ENGINE_HINT}|tail:5h 40%  ⟳ 1 running · 0s`)
  })

  test('nothing to say: the engine line alone, no tail', async ($, on) => {
    const world = installWorld(on)
    world.setRepo(false)
    await startSession($, world)
    expect(textOfNode(await (await mountHint($)).drawn())).toBe(ENGINE_HINT)
  })

  test('with the pane open too, the tail still draws', async ($, on) => {
    const world = installWorld(on)
    await startSession($, world)
    await $.command.run(command(''))
    expect(textOfNode(await (await mountHint($)).drawn())).toContain('⟳ 1 running')
  })

  test('the status line stays quiet about running while the tail shows it', async ($, on) => {
    const world = installWorld(on)
    await startSession($, world)
    await mountHint($)
    await world.clock.advance(3 * SECOND)
    expect(world.statuses.at(-1)).toBeUndefined()
  })

  test('before any footer has drawn, the status line carries the running count', async ($, on) => {
    const world = installWorld(on)
    await startSession($, world)
    await world.clock.advance(3 * SECOND)
    expect(world.statuses.at(-1)).toBe('◐ 1 running')
  })

  test('desktop draws no tail, so the status line keeps the running count', async ($, on) => {
    const world = installWorld(on)
    await startSession($, world)
    expect(textOfNode(await (await mountHint($, HINT_PROPS, 'desktop')).drawn())).toBe(ENGINE_HINT)
    await world.clock.advance(3 * SECOND)
    expect(world.statuses.at(-1)).toBe('◐ 1 running')
  })

  test('a row too narrow for the tail keeps the running count in the status line', async ($, on) => {
    const world = installWorld(on)
    await startSession($, world)
    await mountHint($, HINT_PROPS, 'terminal', 40)
    await world.clock.advance(3 * SECOND)
    expect(world.statuses.at(-1)).toBe('◐ 1 running')
  })

  test('widening the row hands the running count to the footer on the next tick', async ($, on) => {
    const world = installWorld(on)
    await startSession($, world)
    await mountHint($, HINT_PROPS, 'terminal', 40)
    await world.clock.advance(SECOND)
    await mountHint($, HINT_PROPS, 'terminal', 100)
    await world.clock.advance(SECOND)
    expect(world.statuses.at(-1)).toBeUndefined()
  })
})
