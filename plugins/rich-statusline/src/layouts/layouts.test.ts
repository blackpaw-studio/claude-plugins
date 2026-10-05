import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_SETTINGS } from '../settings'
import { buildSnapshot } from '../snapshot'
import { FIXTURE } from '../testing/fixture'
import { rowsOf, runsOf, spanOf, textOf } from '../testing/lines'
import { viewOptions } from '../view-options'
import { renderLayout } from './index'

const C = {
  text: '#e3e5e8',
  muted: '#7d8086',
  dim: '#606369',
  faint: '#52555b',
  separator: '#3f4348',
  empty: '#303338',
  empty1c: '#2b2e33',
  rule: '#24272a',
  system: '#82baff',
  tools: '#3bcfcf',
  mcp: '#c3a5f9',
  memory: '#ee97c9',
  ok: '#8dca80',
  amber: '#f3ae58',
  red: '#f97770',
}

const snapshot = buildSnapshot(FIXTURE)
const draw = (layout: '1a' | '1b' | '1c', columns: number, settings = DEFAULT_SETTINGS, snap = snapshot) =>
  renderLayout(snap, viewOptions({ ...settings, layout }, columns))

const CTX_1A = `${'█'.repeat(9)}${'·'.repeat(42)}┊${'·'.repeat(8)}`

describe('1a grouped rows, design fixture at 120 columns', () => {
  const lines = draw('1a', 120)
  test('exact rows', () => {
    expect(rowsOf(lines)).toEqual([
      '◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ no git  no PR',
      `ctx  ${CTX_1A}  14.0% 28k/200k`,
      '     ■ system 6.4k  ■ tools 8.2k  ■ mcp 3.0k  ■ memory 1.6k  ■ chat 8.8k  ┊ compact 85%',
      '5h   █·········  10%  ↻ 1h 11m  │  week  ███████▌··  75%  ↻ 1d 12h 11m',
    ])
  })
  test('identity colours', () => {
    expect(spanOf(lines[0], '◆ Opus 5.5')).toEqual({ text: '◆ Opus 5.5', color: C.mcp, bold: true })
    expect(runsOf(lines[0])).toEqual([
      `◆ Opus 5.5@${C.mcp}`,
      `thinking @${C.muted}`,
      `medium@${C.text}`,
      `│@${C.separator}`,
      `~/.l/workspace@${C.system}`,
      `⎇ no git@${C.muted}`,
      `no PR@${C.muted}`,
    ])
  })
  test('context bar colours, marker and figures', () => {
    expect(runsOf(lines[1])).toEqual([
      `ctx@${C.muted}`,
      `██@${C.system}`,
      `██@${C.tools}`,
      `█@${C.mcp}`,
      `█@${C.memory}`,
      `███@${C.ok}`,
      `${'·'.repeat(42)}@${C.empty}`,
      `┊@${C.muted}`,
      `${'·'.repeat(8)}@${C.empty}`,
      `14.0%@${C.text}`,
      `28k/200k@${C.muted}`,
    ])
    expect(spanOf(lines[1], '14.0%')?.bold).toBe(true)
  })
  test('legend colours', () => {
    expect(runsOf(lines[2])).toEqual([
      `■@${C.system}`,
      ` system 6.4k@${C.muted}`,
      `■@${C.tools}`,
      ` tools 8.2k@${C.muted}`,
      `■@${C.mcp}`,
      ` mcp 3.0k@${C.muted}`,
      `■@${C.memory}`,
      ` memory 1.6k@${C.muted}`,
      `■@${C.ok}`,
      ` chat 8.8k@${C.muted}`,
      `┊ compact 85%@${C.faint}`,
    ])
  })
  test('limit colours shift to amber', () => {
    expect(runsOf(lines[3])).toEqual([
      `5h @${C.muted}`,
      `█@${C.ok}`,
      `·········@${C.empty}`,
      `10%@${C.text}`,
      `↻ 1h 11m@${C.muted}`,
      `│@${C.separator}`,
      `week@${C.muted}`,
      `███████▌@${C.amber}`,
      `··@${C.empty}`,
      `75%@${C.amber}`,
      `↻ 1d 12h 11m@${C.muted}`,
    ])
  })
})

describe('1b labeled grid, design fixture at 120 columns', () => {
  const lines = draw('1b', 120)
  test('exact rows', () => {
    expect(rowsOf(lines)).toEqual([
      'model   Opus 5.5  ·  thinking medium',
      'where   ~/.l/workspace  ·  no git  ·  no PR',
      `context ${'█'.repeat(9)}${'░'.repeat(51)}  14.0%`,
      '        sys 6.4k  tools 8.2k  mcp 3.0k  mem 1.6k  chat 8.8k  · 172k free',
      'limits  session 10% resets 1h 11m    weekly 75% resets 1d 12h 11m',
      '─'.repeat(120),
    ])
  })
  test('colours', () => {
    expect(runsOf(lines[0])).toEqual([`model   @${C.dim}`, `Opus 5.5@${C.mcp}`, `  ·  thinking @${C.muted}`, `medium@${C.text}`])
    expect(runsOf(lines[1])).toEqual([`where   @${C.dim}`, `~/.l/workspace@${C.system}`, `  ·  no git  ·  no PR@${C.muted}`])
    expect(spanOf(lines[2], '░'.repeat(51))?.color).toBe(C.empty)
    expect(runsOf(lines[3])).toEqual([
      `sys@${C.system}`,
      ` 6.4k  @${C.muted}`,
      `tools@${C.tools}`,
      ` 8.2k  @${C.muted}`,
      `mcp@${C.mcp}`,
      ` 3.0k  @${C.muted}`,
      `mem@${C.memory}`,
      ` 1.6k  @${C.muted}`,
      `chat@${C.ok}`,
      ` 8.8k  @${C.muted}`,
      `· 172k free@${C.faint}`,
    ])
    expect(runsOf(lines[4])).toEqual([
      `limits  @${C.dim}`,
      `session @${C.muted}`,
      `10%@${C.text}`,
      ` resets 1h 11m    weekly @${C.muted}`,
      `75%@${C.amber}`,
      ` resets 1d 12h 11m@${C.muted}`,
    ])
    expect(runsOf(lines[5])).toEqual([`${'─'.repeat(120)}@${C.rule}`])
  })
})

describe('1c compact, design fixture at 100 columns', () => {
  const lines = draw('1c', 100)
  test('exact rows', () => {
    const left = 'Opus 5.5·med  ~/.l/workspace  no git · no PR'
    const right = 'ctx 14%  sys tools mcp mem chat'
    const limits = '5h 10% ↻1h11m   wk 75% ↻1d12h'
    expect(rowsOf(lines)).toEqual([
      '▀'.repeat(100),
      `${left}${' '.repeat(100 - left.length - right.length)}${right}`,
      `${' '.repeat(100 - limits.length)}${limits}`,
    ])
  })
  test('colours', () => {
    expect(runsOf(lines[0])).toEqual([
      `▀▀▀@${C.system}`,
      `▀▀▀▀@${C.tools}`,
      `▀▀@${C.mcp}`,
      `▀@${C.memory}`,
      `▀▀▀▀@${C.ok}`,
      `${'▀'.repeat(86)}@${C.empty1c}`,
    ])
    expect(runsOf(lines[1])).toEqual([
      `Opus 5.5@${C.mcp}`,
      `·med  @${C.muted}`,
      `~/.l/workspace@${C.system}`,
      `  no git · no PR@${C.dim}`,
      `ctx @${C.muted}`,
      `14%@${C.text}`,
      `sys@${C.system}`,
      `tools@${C.tools}`,
      `mcp@${C.mcp}`,
      `mem@${C.memory}`,
      `chat@${C.ok}`,
    ])
    expect(runsOf(lines[2])).toEqual([
      `5h @${C.muted}`,
      `10%@${C.text}`,
      ` ↻1h11m   @${C.dim}`,
      `wk @${C.muted}`,
      `75%@${C.amber}`,
      ` ↻1d12h@${C.dim}`,
    ])
  })
})

describe('git, diff stats, PR and cost', () => {
  const snap = buildSnapshot({
    ...FIXTURE,
    git: { branch: 'main', diff: { insertions: 12, deletions: 3 } },
    pr: { label: '#123', branch: 'main' },
    usage: { ...FIXTURE.usage!, costUsd: 1.234 },
  })
  test('1a identity row', () => {
    const [row] = draw('1a', 120, DEFAULT_SETTINGS, snap)
    expect(textOf(row)).toBe('◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ main (+12,-3)  #123  $1.23')
    expect(runsOf(row).slice(5)).toEqual([
      `⎇ main@${C.muted}`,
      ` (@${C.muted}`,
      `+12@${C.ok}`,
      `,@${C.muted}`,
      `-3@${C.red}`,
      `)@${C.muted}`,
      `#123@${C.muted}`,
      `$1.23@${C.muted}`,
    ])
  })
  test('1b where and limits rows', () => {
    const lines = draw('1b', 120, DEFAULT_SETTINGS, snap)
    expect(textOf(lines[1])).toBe('where   ~/.l/workspace  ·  main (+12,-3)  ·  #123')
    expect(textOf(lines[4])).toBe('limits  session 10% resets 1h 11m    weekly 75% resets 1d 12h 11m  ·  $1.23')
  })
  test('1c rows', () => {
    const lines = draw('1c', 100, DEFAULT_SETTINGS, snap)
    expect(textOf(lines[1]).startsWith('Opus 5.5·med  ~/.l/workspace  main (+12,-3) · #123')).toBe(true)
    expect(textOf(lines[2]).trimStart()).toBe('$1.23   5h 10% ↻1h11m   wk 75% ↻1d12h')
  })
  test('toggles hide diff, PR and cost', () => {
    const settings = { ...DEFAULT_SETTINGS, showDiff: false, showPr: false, showCost: false }
    const [row] = draw('1a', 120, settings, snap)
    expect(textOf(row)).toBe('◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ main')
  })
})

describe('extrapolated states', () => {
  test('no rate limits hides the limits rows', () => {
    const snap = buildSnapshot({ ...FIXTURE, usage: { ...FIXTURE.usage!, rateLimits: [] } })
    expect(draw('1a', 120, DEFAULT_SETTINGS, snap)).toHaveLength(3)
    expect(rowsOf(draw('1b', 120, DEFAULT_SETTINGS, snap)).some(row => row.startsWith('limits'))).toBe(false)
    expect(draw('1c', 100, DEFAULT_SETTINGS, snap)).toHaveLength(2)
  })
  test('no context reading shows a dash over an empty bar', () => {
    const snap = buildSnapshot({ ...FIXTURE, usage: null, breakdown: null })
    const lines = draw('1a', 120, DEFAULT_SETTINGS, snap)
    expect(textOf(lines[1])).toBe(`ctx  ${'·'.repeat(60)}  —`)
    expect(textOf(draw('1c', 100, DEFAULT_SETTINGS, snap)[1]).trimEnd().endsWith('ctx —')).toBe(true)
  })
  test('red context percent at the red threshold', () => {
    const snap = buildSnapshot({ ...FIXTURE, usage: { ...FIXTURE.usage!, tokens: 182_000 } })
    expect(spanOf(draw('1a', 120, DEFAULT_SETTINGS, snap)[1], '91.0%')?.color).toBe(C.red)
  })
  test('effort unknown omits thinking', () => {
    const snap = buildSnapshot({ ...FIXTURE, identity: { ...FIXTURE.identity!, effort: undefined } })
    expect(textOf(draw('1a', 120, DEFAULT_SETTINGS, snap)[0])).toBe('◆ Opus 5.5  │  ~/.l/workspace  ⎇ no git  no PR')
    expect(textOf(draw('1b', 120, DEFAULT_SETTINGS, snap)[0])).toBe('model   Opus 5.5')
    expect(textOf(draw('1c', 100, DEFAULT_SETTINGS, snap)[1]).startsWith('Opus 5.5  ~/.l/workspace')).toBe(true)
  })
  test('under 100 columns the legend goes', () => {
    expect(rowsOf(draw('1a', 99)).some(row => row.includes('■'))).toBe(false)
    expect(rowsOf(draw('1b', 99)).some(row => row.includes('free'))).toBe(false)
  })
  test('legend toggle', () => {
    expect(draw('1a', 120, { ...DEFAULT_SETTINGS, showLegend: false })).toHaveLength(3)
  })
  test('under 80 columns resets and PR go and the bar fits', () => {
    const rows = rowsOf(draw('1a', 79))
    expect(rows[0]).toBe('◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ no git')
    expect(rows[2]).toBe('5h   █·········  10%  │  week  ███████▌··  75%')
    expect(rows.every(row => row.length <= 79)).toBe(true)
  })
  test('under 60 columns forces 1c', () => {
    const lines = draw('1a', 59)
    expect(textOf(lines[0])).toBe('▀'.repeat(59))
  })
})
