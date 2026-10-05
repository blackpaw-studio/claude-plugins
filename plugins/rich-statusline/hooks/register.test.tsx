import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { TICK_MS } from '../src/runtime'
import { ENGINE_BAND, ENGINE_HINT, installWorld, NOW, PROMPT_HINT, rowsOfTree, SETTINGS_BAND, textOfNode } from '../src/testing/world'

const PLUGIN = 'rich-statusline'
const run = (args: string) => ({
  command: PLUGIN,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})
const CTX_1A = `${'▆'.repeat(9)}${'·'.repeat(42)}┊${'·'.repeat(8)}`

const mountHint = ($: Engine, columns = 120) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PROMPT_HINT, viewport: { columns, rows: 40 } })

describe('the status rows under the prompt', () => {
  // These rows are drawn in 1a (grouped rows); the default layout is 1b.
  const GROUPED = { settings: { layout: '1a' } }

  test('draws 1a from the session, a blank row above, and the engine line right after, unchanged', async ($, on) => {
    const world = installWorld(on, { stored: GROUPED, branch: 'main' })
    const ui = await mountHint($)
    await world.clock.settle()
    const rows = rowsOfTree(await ui.drawn())
    expect(rows.map(textOfNode)).toEqual([
      ' ',
      '◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ main (+12,-3)  #123',
      `ctx  ${CTX_1A}  14.0% 28k/200k`,
      '     ■ system 6.4k  ■ tools 8.2k  ■ mcp 3.0k  ■ memory 1.6k  ■ chat 8.8k  ┊ compact 85%',
      '5h   ▆·········  10%  ↻ 1h 11m  │  week  ▆▆▆▆▆▆▆▆··  75%  ↻ 1d 12h 11m',
      // The rule spans the hint row: 120 less the engine's 2-column inset.
      '─'.repeat(116),
      ENGINE_HINT,
    ])
    expect(rows[rows.length - 1]).toEqual({ type: 'Text', props: { dimColor: true }, children: [ENGINE_HINT] })
    // Theme palette slots and dimColor only, never hex.
    const spans = (rows[1] as { children: unknown[] }).children
    expect(spans[0]).toEqual({ type: 'Text', props: { color: 'ansi256(5)', bold: true }, children: ['◆ Opus 5.5'] })
    expect(spans).toContainEqual({ type: 'Text', props: { dimColor: true }, children: ['│'] })
    expect(world.runs).toEqual([
      'git rev-parse --show-toplevel',
      'git rev-parse --path-format=absolute --git-dir --git-common-dir',
      'git rev-parse --abbrev-ref HEAD',
      'git diff HEAD --shortstat',
      'gh pr view --json number,state',
    ])
  })

  test('outside a repository: no git, no PR, gh never asked', async ($, on) => {
    const world = installWorld(on, { stored: GROUPED })
    const ui = await mountHint($)
    await world.clock.settle()
    expect(textOfNode(rowsOfTree(await ui.drawn())[1])).toBe('◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ no git  no PR')
    expect(world.runs.some(run => run.startsWith('gh'))).toBe(false)
  })

  test('a failing usage read still starts git and the clock', async ($, on) => {
    const world = installWorld(on, { stored: GROUPED, branch: 'main', isUsageBroken: true })
    const ui = await mountHint($)
    await world.clock.settle()
    expect(textOfNode(rowsOfTree(await ui.drawn())[1])).toBe(
      '◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ main (+12,-3)  #123',
    )
    const before = world.runs.length
    await world.clock.advance(10_000)
    expect(world.runs.length).toBeGreaterThan(before)
  })

  test('a session start (resume) reads git again', async ($, on) => {
    const world = installWorld(on, { stored: GROUPED, branch: 'main' })
    await mountHint($)
    await world.clock.settle()
    const before = world.runs.filter(run => run.includes('--show-toplevel')).length
    await $.session.start({ cwd: '/Users/evan/.leo/workspace', surface: 'terminal', isInteractive: true })
    await world.clock.settle()
    expect(world.runs.filter(run => run.includes('--show-toplevel')).length).toBe(before + 1)
  })

  // With isStateScoped nothing redraws on a write: each read is a fresh mount.
  const drawnRows = async ($: Engine) => rowsOfTree(await (await mountHint($)).drawn()).map(textOfNode)
  const gitReads = (world: { runs: string[] }) => world.runs.filter(run => run.includes('--show-toplevel')).length

  test('after a /clear empties the session state, the rows come back and every collector reads again', async ($, on) => {
    const world = installWorld(on, { stored: GROUPED, branch: 'main', isStateScoped: true })
    await mountHint($)
    await world.clock.settle()
    const before = await drawnRows($)
    const [gits, usages] = [gitReads(world), world.usageCalls()]
    await $.session.end({ reason: 'clear', sessionId: 'cleared', resume: { id: 'cleared' } })
    await world.clock.settle()
    expect(before).toHaveLength(7)
    expect(await drawnRows($)).toEqual(before)
    expect([gitReads(world), world.usageCalls()]).toEqual([gits + 1, usages + 1])
  })

  test('state emptied with no event: the next draw seeds it again, once however often it draws', async ($, on) => {
    const world = installWorld(on, { stored: GROUPED, branch: 'main', isStateScoped: true })
    await mountHint($)
    await world.clock.settle()
    // Past the bound on draw-asked reseeds, counted from the start's own seed.
    await world.clock.advance(TICK_MS)
    const before = await drawnRows($)
    const [gits, usages] = [gitReads(world), world.usageCalls()]
    world.wipeState()
    expect(await drawnRows($)).toEqual([ENGINE_HINT])
    await drawnRows($)
    await drawnRows($)
    await world.clock.settle()
    expect(await drawnRows($)).toEqual(before)
    expect([gitReads(world), world.usageCalls()]).toEqual([gits + 1, usages + 1])
  })

  test('a settings write that keeps failing: draws reseed at most once a tick and read nothing else', async ($, on) => {
    const world = installWorld(on, { stored: GROUPED, branch: 'main', isStateScoped: true, isSettingsRefused: true })
    await mountHint($)
    for (let draw = 0; draw < 5; draw += 1) {
      await world.clock.settle()
      expect(await drawnRows($)).toEqual([ENGINE_HINT])
    }
    await world.clock.settle()
    expect(world.storeReads()).toBe(1)
    await world.clock.advance(TICK_MS)
    for (let draw = 0; draw < 5; draw += 1) {
      await drawnRows($)
      await world.clock.settle()
    }
    expect(world.storeReads()).toBe(2)
    // No seed got past the settings: usage is read by seeds alone (the timers still poll git).
    expect(world.usageCalls()).toBe(0)
  })

  test('nothing but the engine line until the stored settings have loaded', async ($, on) => {
    installWorld(on, { stored: { settings: { layout: '1c' } } })
    const ui = await mountHint($)
    expect(rowsOfTree(await ui.drawn()).map(textOfNode)).toEqual([ENGINE_HINT])
  })

  test('a refresh that finds nothing new does not redraw', async ($, on) => {
    const world = installWorld(on, { stored: GROUPED, branch: 'main' })
    await mountHint($)
    await world.clock.settle()
    const draws = world.hintDraws()
    await world.clock.advance(10_000)
    expect(world.runs.filter(run => run.includes('--show-toplevel')).length).toBe(2)
    expect(world.hintDraws()).toBe(draws)
  })

  test('other surfaces get the engine line alone', async ($, on) => {
    installWorld(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PROMPT_HINT })
    expect(textOfNode(await ui.drawn())).toBe(ENGINE_HINT)
  })

  test('a measurement updates cost and asks for a debounced breakdown', async ($, on) => {
    const world = installWorld(on, { stored: GROUPED })
    const ui = await mountHint($)
    await world.clock.settle()
    const before = world.usageCalls()
    await $.session.measure({
      context: { tokens: 30_000, window: 200_000, percent: 15 },
      rateLimits: [],
      cost: { usd: 1.234 },
      changed: ['context', 'cost'],
    })
    const rows = rowsOfTree(await ui.drawn()).map(textOfNode)
    expect(rows[1]?.endsWith('no PR  $1.23')).toBe(true)
    expect(rows[2]?.endsWith('15.0% 30k/200k')).toBe(true)
    expect(world.usageCalls()).toBe(before)
    await world.clock.advance(2_000)
    expect(world.usageCalls()).toBe(before + 1)
  })

  for (const layout of ['1a', '1b', '1c']) {
    test(`${layout}: every row fits the hint row, the viewport less the engine's 2-column padding on each side`, async ($, on) => {
      const world = installWorld(on, { stored: { settings: { layout } }, branch: 'main' })
      await mountHint($)
      await world.clock.settle()
      const overflows: string[] = []
      for (const columns of [0, 1, 2, 3, 20, 40, 59, 60, 62, 80, 82, 100, 102, 110, 120, 160]) {
        const inset = Math.max(0, columns - 4)
        // Our rows only: not the blank row above, not the engine's line below.
        const rows = rowsOfTree(await (await mountHint($, columns)).drawn()).map(textOfNode).slice(1, -1)
        const widths = rows.map(row => [...row].length)
        // Under 20 columns 1c's figures alone outrun the row; the Text cuts them.
        const tooWide = columns < 20 ? [] : widths.filter(width => width > inset)
        if (tooWide.length > 0) overflows.push(`at ${columns}: ${tooWide.join(',')}`)
        // The rule still spans the whole inset row.
        if (widths[widths.length - 1] !== inset) overflows.push(`rule at ${columns}: ${widths[widths.length - 1]}`)
      }
      expect(overflows).toEqual([])
    })
  }

  test('the width breakpoints read the inset width, not the viewport', async ($, on) => {
    const world = installWorld(on, { stored: GROUPED, branch: 'main' })
    await mountHint($)
    await world.clock.settle()
    // Viewport 83 is a 79-column row: under 80, so the reset countdowns go.
    const rowsAt = async (columns: number) => rowsOfTree(await (await mountHint($, columns)).drawn()).map(textOfNode)
    expect((await rowsAt(84)).some(row => row.includes('↻'))).toBe(true)
    expect((await rowsAt(83)).some(row => row.includes('↻'))).toBe(false)
  })

  test('reset countdowns tick with the clock', async ($, on) => {
    const world = installWorld(on, { stored: GROUPED })
    const ui = await mountHint($)
    await world.clock.settle()
    await world.clock.set(NOW + 60_000)
    const rows = rowsOfTree(await ui.drawn()).map(textOfNode)
    expect(rows[4]).toBe('5h   ▆·········  10%  ↻ 1h 10m  │  week  ▆▆▆▆▆▆▆▆··  75%  ↻ 1d 12h 10m')
  })
})

describe('the settings menu in the band above the prompt', () => {
  type Drawn = { type?: string; props?: { key?: string }; children?: unknown[] }
  const buttonsOf = (row: unknown): (string | undefined)[] =>
    ((row as Drawn).children ?? []).filter(node => (node as Drawn).type === 'Button').map(node => (node as Drawn).props?.key)

  const mountBand = ($: Engine, props: Partial<typeof SETTINGS_BAND.props> = {}) =>
    $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...SETTINGS_BAND, props: { ...SETTINGS_BAND.props, ...props } })

  const ready = async ($: Engine, on: Parameters<typeof installWorld>[0]) => {
    const world = installWorld(on)
    const hint = await mountHint($, 100)
    await world.clock.settle()
    return { world, hint }
  }

  test('the band is the engine\'s own while the menu is closed', async ($, on) => {
    await ready($, on)
    const band = await mountBand($)
    expect(textOfNode(await band.drawn())).toBe(ENGINE_BAND)
  })

  test('/rich-statusline toggles the menu with no output and opens no pane', async ($, on) => {
    await ready($, on)
    const band = await mountBand($)
    expect(await $.command.run(run(''))).toEqual({})
    expect(await band.findAll({ type: 'Select' })).toHaveLength(10)
    expect(await $.command.run(run('settings'))).toEqual({})
    expect(textOfNode(await band.drawn())).toBe(ENGINE_BAND)
    expect((await $.command.run(run('bogus'))).text).toBe('Usage: /rich-statusline [settings]')
  })

  test('a survey keeps the band even while the menu is open', async ($, on) => {
    await ready($, on)
    await $.command.run(run(''))
    const band = await mountBand($, { hasSurvey: true })
    expect(textOfNode(await band.drawn())).toBe(ENGINE_BAND)
  })

  test('open: header, every control, Done and Reset', async ($, on) => {
    await ready($, on)
    await $.command.run(run(''))
    const band = await mountBand($)
    const [title, hint] = rowsOfTree(await band.drawn())
    expect(textOfNode(title)).toBe('rich-statusline settings')
    expect(buttonsOf(title)).toEqual(['done', 'reset'])
    expect(textOfNode(hint)).toBe('ctrl+x tab to focus · ↑↓/tab move · enter change')
    const selects = await band.findAll({ type: 'Select' })
    expect(selects.map(select => select.key)).toEqual([
      'layout',
      'showCost',
      'showPr',
      'showDiff',
      'showWorktree',
      'showLegend',
      'amberPercent',
      'redPercent',
      'gitRefreshSeconds',
      'prRefreshSeconds',
    ])
    expect(selects[0]?.props.value).toBe('1b')
    expect((await band.find({ type: 'Button', key: 'done' }))?.props).toMatchObject({ hotkey: 'd', role: 'dismiss' })
    expect(await band.find({ type: 'Button', key: 'reset' })).toBeDefined()
  })

  test('a short band keeps Done and Reset on the title row and drops the hint', async ($, on) => {
    await ready($, on)
    await $.command.run(run(''))
    const band = await mountBand($, { maxRows: 5, scroll: { offset: 0, bodyRows: 4 } })
    const [title, ...rest] = rowsOfTree(await band.drawn())
    expect(textOfNode(title)).toBe('rich-statusline settings')
    expect(buttonsOf(title)).toEqual(['done', 'reset'])
    expect(rest.map(textOfNode).join('\n')).not.toContain('ctrl+x tab')
    expect(await band.findAll({ type: 'Select' })).toHaveLength(10)
  })

  test('a short band at 106 columns keeps cells apart and inside the row', async ($, on) => {
    await ready($, on)
    await $.command.run(run(''))
    const band = await mountBand($, { bodyColumns: 106, maxRows: 5, scroll: { offset: 0, bodyRows: 4 } })
    const [, ...controlRows] = rowsOfTree(await band.drawn()) as { props?: { gap?: number }; children?: { props?: { width?: number } }[] }[]
    const overflows = controlRows.flatMap((row, index) => {
      const cells = row.children ?? []
      const gap = row.props?.gap ?? 0
      const extent = cells.reduce((sum, cell) => sum + (cell.props?.width ?? 0), 0) + gap * (cells.length - 1)
      return [
        ...(cells.length > 1 && gap < 2 ? [`row ${index}: gap ${gap}`] : []),
        ...(extent > 106 ? [`row ${index}: ${extent} cells`] : []),
      ]
    })
    expect(overflows).toEqual([])
  })

  test('Done closes the menu', async ($, on) => {
    await ready($, on)
    await $.command.run(run(''))
    const band = await mountBand($)
    await band.press({ key: 'done' })
    expect(textOfNode(await band.drawn())).toBe(ENGINE_BAND)
  })

  test('picking a layout redraws the status rows and persists; Reset restores', async ($, on) => {
    const { world, hint } = await ready($, on)
    await $.command.run(run(''))
    const band = await mountBand($)
    await band.select({ key: 'layout', value: '1c' })
    const rows = rowsOfTree(await hint.drawn()).map(textOfNode)
    expect(rows[1]).toBe('▀'.repeat(96))
    expect((await band.find({ type: 'Select', key: 'layout' }))?.props.value).toBe('1c')
    expect(world.stores[world.stores.length - 1]).toMatchObject({ key: 'settings', value: { layout: '1c' } })
    await band.press({ key: 'reset' })
    expect((await band.find({ type: 'Select', key: 'layout' }))?.props.value).toBe('1b')
  })

  test('quick picks persist in order, each over the last', async ($, on) => {
    const { world } = await ready($, on)
    await $.command.run(run(''))
    const band = await mountBand($)
    await Promise.all([
      band.select({ key: 'layout', value: '1c' }),
      band.select({ key: 'showCost', value: 'off' }),
      band.select({ key: 'showPr', value: 'off' }),
    ])
    const values = world.stores.map(write => (write as { value: Record<string, unknown> }).value)
    expect(values.map(v => [v.layout, v.showCost, v.showPr])).toEqual([
      ['1c', true, true],
      ['1c', false, true],
      ['1c', false, false],
    ])
  })

  test('stored settings load at start; junk falls back to defaults', async ($, on) => {
    const world = installWorld(on, { stored: { settings: { layout: '1b', redPercent: 'very' } } })
    const ui = await mountHint($)
    await world.clock.settle()
    const rows = rowsOfTree(await ui.drawn()).map(textOfNode)
    expect(rows[1]).toBe('model   Opus 5.5  ·  thinking medium')
    // The block ends in its rule; the engine's hint line follows it directly.
    expect(rows.slice(-2)).toEqual(['─'.repeat(116), ENGINE_HINT])
  })
})
