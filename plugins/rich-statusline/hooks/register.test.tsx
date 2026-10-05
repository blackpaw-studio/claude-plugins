import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { ENGINE_HINT, installWorld, NOW, PROMPT_HINT, rowsOfTree, SETTINGS_PANE, textOfNode } from '../src/testing/world'

const PLUGIN = 'rich-statusline'
const run = (args: string) => ({
  command: PLUGIN,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})
const CTX_1A = `${'█'.repeat(9)}${'·'.repeat(42)}┊${'·'.repeat(8)}`

const mountHint = ($: Engine, columns = 120) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PROMPT_HINT, viewport: { columns, rows: 40 } })

describe('the status rows under the prompt', () => {
  test('draws 1a from the session and keeps the engine line last, unchanged', async ($, on) => {
    const world = installWorld(on, { branch: 'main' })
    const ui = await mountHint($)
    await world.clock.settle()
    const rows = rowsOfTree(await ui.drawn())
    expect(rows.map(textOfNode)).toEqual([
      '◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ main (+12,-3)  #123',
      `ctx  ${CTX_1A}  14.0% 28k/200k`,
      '     ■ system 6.4k  ■ tools 8.2k  ■ mcp 3.0k  ■ memory 1.6k  ■ chat 8.8k  ┊ compact 85%',
      '5h   █·········  10%  ↻ 1h 11m  │  week  ███████▌··  75%  ↻ 1d 12h 11m',
      ENGINE_HINT,
    ])
    expect(rows[rows.length - 1]).toEqual({ type: 'Text', props: { dimColor: true }, children: [ENGINE_HINT] })
    expect(world.runs).toEqual([
      'git rev-parse --show-toplevel',
      'git rev-parse --abbrev-ref HEAD',
      'git diff HEAD --shortstat',
      'gh pr view --json number,state',
    ])
  })

  test('outside a repository: no git, no PR, gh never asked', async ($, on) => {
    const world = installWorld(on)
    const ui = await mountHint($)
    await world.clock.settle()
    expect(textOfNode(rowsOfTree(await ui.drawn())[0])).toBe('◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ no git  no PR')
    expect(world.runs.some(run => run.startsWith('gh'))).toBe(false)
  })

  test('a failing usage read still starts git and the clock', async ($, on) => {
    const world = installWorld(on, { branch: 'main', isUsageBroken: true })
    const ui = await mountHint($)
    await world.clock.settle()
    expect(textOfNode(rowsOfTree(await ui.drawn())[0])).toBe(
      '◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ main (+12,-3)  #123',
    )
    const before = world.runs.length
    await world.clock.advance(10_000)
    expect(world.runs.length).toBeGreaterThan(before)
  })

  test('other surfaces get the engine line alone', async ($, on) => {
    installWorld(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PROMPT_HINT })
    expect(textOfNode(await ui.drawn())).toBe(ENGINE_HINT)
  })

  test('a measurement updates cost and asks for a debounced breakdown', async ($, on) => {
    const world = installWorld(on)
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
    expect(rows[0]?.endsWith('no PR  $1.23')).toBe(true)
    expect(rows[1]?.endsWith('15.0% 30k/200k')).toBe(true)
    expect(world.usageCalls()).toBe(before)
    await world.clock.advance(2_000)
    expect(world.usageCalls()).toBe(before + 1)
  })

  test('reset countdowns tick with the clock', async ($, on) => {
    const world = installWorld(on)
    const ui = await mountHint($)
    await world.clock.settle()
    await world.clock.set(NOW + 60_000)
    const rows = rowsOfTree(await ui.drawn()).map(textOfNode)
    expect(rows[3]).toBe('5h   █·········  10%  ↻ 1h 10m  │  week  ███████▌··  75%  ↻ 1d 12h 10m')
  })
})

describe('the settings panel', () => {
  test('/rich-statusline opens a focused dialog pane', async ($, on) => {
    const world = installWorld(on)
    await mountHint($)
    await world.clock.settle()
    expect(await $.command.run(run(''))).toEqual({})
    expect(await $.command.run(run('settings'))).toEqual({})
    expect((await $.command.run(run('bogus'))).text).toBe('Usage: /rich-statusline [settings]')
    expect(world.opened).toHaveLength(2)
    expect(world.opened[0]).toMatchObject({ id: 'rich-statusline-settings', focus: true, closeOnEscape: true })
  })

  for (const surface of ['terminal'] as const) {
    test(`picking a layout re-renders the rows and persists (${surface})`, async ($, on) => {
      const world = installWorld(on)
      const hint = await mountHint($, 100)
      await world.clock.settle()
      const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...SETTINGS_PANE })
      const selects = await pane.findAll({ type: 'Select' })
      expect(selects.map(s => s.key)).toEqual([
        'layout',
        'showCost',
        'showPr',
        'showDiff',
        'showLegend',
        'amberPercent',
        'redPercent',
        'gitRefreshSeconds',
        'prRefreshSeconds',
      ])
      expect(selects[0]?.props.autoFocus).toBe(true)
      expect(selects[0]?.props.value).toBe('1a')

      await pane.select({ key: 'layout', value: '1c' })
      const rows = rowsOfTree(await hint.drawn()).map(textOfNode)
      expect(rows[0]).toBe('▀'.repeat(100))
      expect((await pane.find({ type: 'Select', key: 'layout' }))?.props.value).toBe('1c')
      expect(world.stores[world.stores.length - 1]).toMatchObject({ key: 'settings', value: { layout: '1c' } })

      await pane.select({ key: 'showLegend', value: 'off' })
      await pane.press({ key: 'reset' })
      expect((await pane.find({ type: 'Select', key: 'layout' }))?.props.value).toBe('1a')
      await pane.press({ key: 'done' })
    })
  }

  test('stored settings load at start; junk falls back to defaults', async ($, on) => {
    const world = installWorld(on, { stored: { settings: { layout: '1b', redPercent: 'very' } } })
    const ui = await mountHint($)
    await world.clock.settle()
    expect(textOfNode(rowsOfTree(await ui.drawn())[0])).toBe('model   Opus 5.5  ·  thinking medium')
  })
})
