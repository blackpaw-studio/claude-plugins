import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
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
  test('draws 1a from the session and keeps the engine line last, unchanged', async ($, on) => {
    const world = installWorld(on, { branch: 'main' })
    const ui = await mountHint($)
    await world.clock.settle()
    const rows = rowsOfTree(await ui.drawn())
    expect(rows.map(textOfNode)).toEqual([
      ' ',
      '◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ main (+12,-3)  #123',
      `ctx  ${CTX_1A}  14.0% 28k/200k`,
      '     ■ system 6.4k  ■ tools 8.2k  ■ mcp 3.0k  ■ memory 1.6k  ■ chat 8.8k  ┊ compact 85%',
      '5h   ▆·········  10%  ↻ 1h 11m  │  week  ▆▆▆▆▆▆▆▆··  75%  ↻ 1d 12h 11m',
      ' ',
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
    expect(textOfNode(rowsOfTree(await ui.drawn())[1])).toBe('◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ no git  no PR')
    expect(world.runs.some(run => run.startsWith('gh'))).toBe(false)
  })

  test('a failing usage read still starts git and the clock', async ($, on) => {
    const world = installWorld(on, { branch: 'main', isUsageBroken: true })
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
    const world = installWorld(on, { branch: 'main' })
    await mountHint($)
    await world.clock.settle()
    const before = world.runs.filter(run => run.includes('--show-toplevel')).length
    await $.session.start({ cwd: '/Users/evan/.leo/workspace', surface: 'terminal', isInteractive: true })
    await world.clock.settle()
    expect(world.runs.filter(run => run.includes('--show-toplevel')).length).toBe(before + 1)
  })

  test('nothing but the engine line until the stored settings have loaded', async ($, on) => {
    installWorld(on, { stored: { settings: { layout: '1c' } } })
    const ui = await mountHint($)
    expect(rowsOfTree(await ui.drawn()).map(textOfNode)).toEqual([ENGINE_HINT])
  })

  test('a refresh that finds nothing new does not redraw', async ($, on) => {
    const world = installWorld(on, { branch: 'main' })
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
    expect(rows[1]?.endsWith('no PR  $1.23')).toBe(true)
    expect(rows[2]?.endsWith('15.0% 30k/200k')).toBe(true)
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
    expect(rows[4]).toBe('5h   ▆·········  10%  ↻ 1h 10m  │  week  ▆▆▆▆▆▆▆▆··  75%  ↻ 1d 12h 10m')
  })
})

describe('the settings menu in the band above the prompt', () => {
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
    expect(await band.findAll({ type: 'Select' })).toHaveLength(9)
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
    expect((await band.find({ type: 'Text', text: /^rich-statusline settings/ }))?.text).toBe(
      'rich-statusline settings  ctrl+x tab to focus · ↑↓/tab move · enter change',
    )
    const selects = await band.findAll({ type: 'Select' })
    expect(selects.map(select => select.key)).toEqual([
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
    expect(selects[0]?.props.value).toBe('1a')
    expect((await band.find({ type: 'Button', key: 'done' }))?.props).toMatchObject({ hotkey: 'd', role: 'dismiss' })
    expect(await band.find({ type: 'Button', key: 'reset' })).toBeDefined()
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
    expect(rows[1]).toBe('▀'.repeat(100))
    expect((await band.find({ type: 'Select', key: 'layout' }))?.props.value).toBe('1c')
    expect(world.stores[world.stores.length - 1]).toMatchObject({ key: 'settings', value: { layout: '1c' } })
    await band.press({ key: 'reset' })
    expect((await band.find({ type: 'Select', key: 'layout' }))?.props.value).toBe('1a')
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
    expect(textOfNode(rowsOfTree(await ui.drawn())[1])).toBe('model   Opus 5.5  ·  thinking medium')
  })
})
