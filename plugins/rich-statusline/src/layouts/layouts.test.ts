import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_SETTINGS } from '../settings'
import { buildSnapshot } from '../snapshot'
import { FIXTURE } from '../testing/fixture'
import { rowsOf, runsOf, spanOf, textOf, toneOf } from '../testing/lines'
import { viewOptions } from '../view-options'
import { renderLayout } from './index'

/** The terminal theme's normal slots by index; gray (slot 8) is the one exception. */
const C = {
  text: 'fg',
  muted: 'ansi256(8)',
  dim: 'fg+dim',
  faint: 'fg+dim',
  separator: 'fg+dim',
  empty: 'ansi256(8)+dim',
  empty1c: 'ansi256(8)+dim',
  rule: 'ansi256(8)+dim',
  system: 'ansi256(4)',
  tools: 'ansi256(6)',
  mcp: 'ansi256(5)',
  memory: 'ansi256(1)',
  ok: 'ansi256(2)',
  amber: 'ansi256(3)',
  red: 'ansi256(1)',
}

const snapshot = buildSnapshot(FIXTURE)
const draw = (layout: '1a' | '1b' | '1c', columns: number, settings = DEFAULT_SETTINGS, snap = snapshot) =>
  renderLayout(snap, viewOptions({ ...settings, layout }, columns))

const CTX_1A = `${'▆'.repeat(9)}${'·'.repeat(42)}┊${'·'.repeat(8)}`

describe('1a grouped rows, design fixture at 120 columns', () => {
  const lines = draw('1a', 120)
  test('exact rows', () => {
    expect(rowsOf(lines)).toEqual([
      '◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ no git  no PR',
      `ctx  ${CTX_1A}  14.0% 28k/200k`,
      '     ■ system 6.4k  ■ tools 8.2k  ■ mcp 3.0k  ■ memory 1.6k  ■ chat 8.8k  ┊ compact 85%',
      '5h   ▆·········  10%  ↻ 1h 11m  │  week  ▆▆▆▆▆▆▆▆··  75%  ↻ 1d 12h 11m',
      '─'.repeat(120),
    ])
    expect(runsOf(lines[4])).toEqual([`${'─'.repeat(120)}@${C.rule}`])
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
      `▆▆@${C.system}`,
      `▆▆@${C.tools}`,
      `▆@${C.mcp}`,
      `▆@${C.memory}`,
      `▆▆▆@${C.ok}`,
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
      `▆@${C.ok}`,
      `·········@${C.empty}`,
      `10%@${C.text}`,
      `↻ 1h 11m@${C.muted}`,
      `│@${C.separator}`,
      `week@${C.muted}`,
      `▆▆▆▆▆▆▆▆@${C.amber}`,
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
      `context ${'▆'.repeat(9)}${'░'.repeat(51)}  14.0%`,
      '        sys 6.4k  tools 8.2k  mcp 3.0k  mem 1.6k  chat 8.8k  · 172k free  · compact 85%',
      'limits  session 10% resets 1h 11m    weekly 75% resets 1d 12h 11m',
      '─'.repeat(120),
    ])
  })
  test('colours', () => {
    expect(runsOf(lines[0])).toEqual([`model   @${C.dim}`, `Opus 5.5@${C.mcp}`, `  ·  thinking @${C.muted}`, `medium@${C.text}`])
    expect(runsOf(lines[1])).toEqual([`where   @${C.dim}`, `~/.l/workspace@${C.system}`, `  ·  no git  ·  no PR@${C.muted}`])
    expect(toneOf(spanOf(lines[2], '░'.repeat(51)))).toBe(C.empty)
    expect(textOf(lines[2])).not.toContain('┊')
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
      `· 172k free  · compact 85%@${C.dim}`,
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
      '─'.repeat(100),
    ])
    expect(runsOf(lines[3])).toEqual([`${'─'.repeat(100)}@${C.rule}`])
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
    git: { root: '/repo', worktree: null, branch: 'main', diff: { insertions: 12, deletions: 3 } },
    pr: { label: '#123', root: '/repo', branch: 'main' },
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
  test('a clean repository shows (+0,-0)', () => {
    const clean = buildSnapshot({ ...FIXTURE, git: { root: '/repo', worktree: null, branch: 'main', diff: { insertions: 0, deletions: 0 } } })
    expect(textOf(draw('1a', 120, DEFAULT_SETTINGS, clean)[0])).toBe('◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ main (+0,-0)  no PR')
  })
  test('toggles hide diff, PR and cost', () => {
    const settings = { ...DEFAULT_SETTINGS, showDiff: false, showPr: false, showCost: false }
    const [row] = draw('1a', 120, settings, snap)
    expect(textOf(row)).toBe('◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ main')
  })
})

describe('a linked worktree, right before the branch', () => {
  const WORKTREE = 'ansi256(5)'
  const inWorktree = (diff = { insertions: 1, deletions: 0 }) =>
    buildSnapshot({ ...FIXTURE, git: { root: '/work/feat-x', worktree: 'feat-x', branch: 'feat/x', diff } })
  const snap = inWorktree()
  const isWtMuted = (line: Parameters<typeof runsOf>[0]) => runsOf(line).some(run => run.endsWith(`wt @${C.muted}`))
  test('1a', () => {
    const [row] = draw('1a', 120, DEFAULT_SETTINGS, snap)
    expect(textOf(row)).toBe('◆ Opus 5.5  thinking medium  │  ~/.l/workspace  wt feat-x  ⎇ feat/x (+1,-0)  no PR')
    expect(toneOf(spanOf(row, 'feat-x'))).toBe(WORKTREE)
    expect(isWtMuted(row)).toBe(true)
  })
  test('1b', () => {
    const row = draw('1b', 120, DEFAULT_SETTINGS, snap)[1]
    expect(textOf(row)).toBe('where   ~/.l/workspace  ·  wt feat-x  ·  feat/x (+1,-0)  ·  no PR')
    expect(toneOf(spanOf(row, 'feat-x'))).toBe(WORKTREE)
    expect(isWtMuted(row)).toBe(true)
  })
  test('1c', () => {
    const row = draw('1c', 100, DEFAULT_SETTINGS, snap)[1]
    expect(textOf(row).startsWith('Opus 5.5·med  ~/.l/workspace  wt feat-x feat/x (+1,-0) · no PR')).toBe(true)
    expect(toneOf(spanOf(row, 'feat-x'))).toBe(WORKTREE)
    expect(isWtMuted(row)).toBe(true)
  })
  test('the main working tree and the toggle show none', () => {
    expect(textOf(draw('1a', 120)[0])).not.toContain('wt ')
    const hidden = { ...DEFAULT_SETTINGS, showWorktree: false }
    expect(textOf(draw('1a', 120, hidden, snap)[0])).toBe('◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ feat/x (+1,-0)  no PR')
    expect(textOf(draw('1b', 120, hidden, snap)[1])).toBe('where   ~/.l/workspace  ·  feat/x (+1,-0)  ·  no PR')
    expect(textOf(draw('1c', 100, hidden, snap)[1]).startsWith('Opus 5.5·med  ~/.l/workspace  feat/x (+1,-0)')).toBe(true)
  })
  test('overflow drops the diff stats before the worktree', () => {
    const heavy = inWorktree({ insertions: 12_345, deletions: 6_789 })
    expect(textOf(draw('1a', 80, DEFAULT_SETTINGS, heavy)[0])).toBe('◆ Opus 5.5  thinking medium  │  ~/.l/workspace  wt feat-x  ⎇ feat/x')
    expect(textOf(draw('1a', 66, DEFAULT_SETTINGS, heavy)[0])).toBe('◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ feat/x')
    expect(textOf(draw('1b', 61, DEFAULT_SETTINGS, heavy)[1])).toBe('where   ~/.l/workspace  ·  wt feat-x  ·  feat/x')
  })
})

describe('a 1M window with a smaller compaction window', () => {
  const snap = buildSnapshot({
    ...FIXTURE,
    usage: { ...FIXTURE.usage!, tokens: 218_000, window: 1_000_000 },
    breakdown: {
      categories: [
        { key: 'system', tokens: 20_000 },
        { key: 'tools', tokens: 40_000 },
        { key: 'mcp', tokens: 10_000 },
        { key: 'memory', tokens: 10_000 },
        { key: 'chat', tokens: 138_000 },
      ],
      rawMaxTokens: 420_000,
      compactThreshold: 386_000,
    },
  })
  const lines = draw('1a', 120, DEFAULT_SETTINGS, snap)
  test('the bar fills as the label reads, marker at the threshold of the whole window', () => {
    const bar = textOf(lines[1]).slice(5, 65)
    expect(textOf(lines[1]).endsWith('21.8% 218k/1M')).toBe(true)
    expect([...bar].filter(cell => cell === '▆').length).toBe(Math.round(0.218 * 60))
    expect([...bar].indexOf('┊')).toBe(Math.round(0.386 * 60))
  })
  test('the legend and 1b free measure against the whole window', () => {
    expect(textOf(lines[2]).endsWith('┊ compact 39%')).toBe(true)
    const grid = draw('1b', 120, DEFAULT_SETTINGS, snap)
    expect(textOf(grid[3]).endsWith('· 782k free  · compact 39%')).toBe(true)
    expect(textOf(grid[2])).not.toContain('┊')
  })
  test('auto-compact off: no 1b compact note', () => {
    const off = buildSnapshot({ ...FIXTURE, breakdown: { ...FIXTURE.breakdown!, compactThreshold: undefined } })
    const grid = rowsOf(draw('1b', 120, DEFAULT_SETTINGS, off))
    expect(grid[2]).toBe(`context ${'▆'.repeat(9)}${'░'.repeat(51)}  14.0%`)
    expect(grid[3]).toBe('        sys 6.4k  tools 8.2k  mcp 3.0k  mem 1.6k  chat 8.8k  · 172k free')
  })
})

describe('zero categories', () => {
  // MCP tools loaded through tool search are deferred, outside the window: mcp is often 0.
  const snap = buildSnapshot({
    ...FIXTURE,
    breakdown: {
      ...FIXTURE.breakdown!,
      categories: FIXTURE.breakdown!.categories.map(category => (category.key === 'mcp' ? { ...category, tokens: 0 } : category)),
    },
  })
  test('every legend leaves them out, the rest in order', () => {
    expect(textOf(draw('1a', 120, DEFAULT_SETTINGS, snap)[2])).toBe(
      '     ■ system 6.4k  ■ tools 8.2k  ■ memory 1.6k  ■ chat 8.8k  ┊ compact 85%',
    )
    expect(textOf(draw('1b', 120, DEFAULT_SETTINGS, snap)[3])).toBe(
      '        sys 6.4k  tools 8.2k  mem 1.6k  chat 8.8k  · 172k free  · compact 85%',
    )
    expect(textOf(draw('1c', 100, DEFAULT_SETTINGS, snap)[1]).endsWith('ctx 14%  sys tools mem chat')).toBe(true)
  })
})

describe('extrapolated states', () => {
  test('no rate limits hides the limits rows', () => {
    const snap = buildSnapshot({ ...FIXTURE, usage: { ...FIXTURE.usage!, rateLimits: [] } })
    expect(draw('1a', 120, DEFAULT_SETTINGS, snap)).toHaveLength(4)
    expect(rowsOf(draw('1b', 120, DEFAULT_SETTINGS, snap)).some(row => row.startsWith('limits'))).toBe(false)
    expect(draw('1c', 100, DEFAULT_SETTINGS, snap)).toHaveLength(3)
  })
  test('no context reading shows a dash over an empty bar', () => {
    const snap = buildSnapshot({ ...FIXTURE, usage: null, breakdown: null })
    const lines = draw('1a', 120, DEFAULT_SETTINGS, snap)
    expect(textOf(lines[1])).toBe(`ctx  ${'·'.repeat(60)}  —`)
    expect(textOf(draw('1c', 100, DEFAULT_SETTINGS, snap)[1]).trimEnd().endsWith('ctx —')).toBe(true)
  })
  test('red context percent at the red threshold', () => {
    const snap = buildSnapshot({ ...FIXTURE, usage: { ...FIXTURE.usage!, tokens: 182_000 } })
    expect(toneOf(spanOf(draw('1a', 120, DEFAULT_SETTINGS, snap)[1], '91.0%'))).toBe(C.red)
  })
  test('the context colour follows the figure as shown', () => {
    const near = (tokens: number) => buildSnapshot({ ...FIXTURE, usage: { ...FIXTURE.usage!, tokens } })
    expect(toneOf(spanOf(draw('1a', 120, DEFAULT_SETTINGS, near(139_920))[1], '70.0%'))).toBe(C.amber)
    expect(toneOf(spanOf(draw('1a', 120, DEFAULT_SETTINGS, near(139_000))[1], '69.5%'))).toBe(C.text)
    expect(toneOf(spanOf(draw('1c', 100, DEFAULT_SETTINGS, near(139_000))[1], '70%'))).toBe(C.amber)
  })
  test('a limit whose window has passed reads stale: dim figure, reset now', () => {
    const snap = buildSnapshot({
      ...FIXTURE,
      usage: { ...FIXTURE.usage!, rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: FIXTURE.now - 60_000 }] },
    })
    const row = draw('1a', 120, DEFAULT_SETTINGS, snap)[3]
    expect(textOf(row)).toBe('5h   ▆▆▆▆······  40%  ↻ now')
    expect(toneOf(spanOf(row, '40%'))).toBe(C.dim)
    expect(textOf(draw('1b', 120, DEFAULT_SETTINGS, snap)[4])).toBe('limits  session 40% resets now')
    expect(textOf(draw('1c', 100, DEFAULT_SETTINGS, snap)[2]).trimStart()).toBe('5h 40% ↻now')
  })
  test('1c with no path yet keeps single gaps', () => {
    const snap = buildSnapshot({ ...FIXTURE, identity: { ...FIXTURE.identity!, cwd: '' } })
    expect(textOf(draw('1c', 100, DEFAULT_SETTINGS, snap)[1]).startsWith('Opus 5.5·med  no git · no PR  ')).toBe(true)
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
    expect(draw('1a', 120, { ...DEFAULT_SETTINGS, showLegend: false })).toHaveLength(4)
  })
  test('under 80 columns resets and PR go and the bar fits', () => {
    const rows = rowsOf(draw('1a', 79))
    expect(rows[0]).toBe('◆ Opus 5.5  thinking medium  │  ~/.l/workspace  ⎇ no git')
    expect(rows[2]).toBe('5h   ▆·········  10%  │  week  ▆▆▆▆▆▆▆▆··  75%')
    expect(rows.every(row => row.length <= 79)).toBe(true)
  })
  test('rows stay inside the width at every breakpoint, with heavy figures', () => {
    const heavy = buildSnapshot({
      ...FIXTURE,
      git: { root: '/repo', worktree: null, branch: 'main', diff: { insertions: 12_345, deletions: 6_789 } },
      pr: { label: '#12345', root: '/repo', branch: 'main' },
      usage: {
        tokens: 1_050_000,
        window: 1_000_000,
        costUsd: 123.45,
        rateLimits: [
          { kind: 'five_hour', percentUsed: 100, resetsAt: FIXTURE.now + (4 * 60 + 59) * 60_000 + 30_000 },
          { kind: 'seven_day', percentUsed: 100, resetsAt: FIXTURE.now + ((6 * 24 + 23) * 60 + 59) * 60_000 + 30_000 },
        ],
      },
      breakdown: {
        categories: [
          { key: 'system', tokens: 12_000 },
          { key: 'tools', tokens: 48_000 },
          { key: 'mcp', tokens: 33_000 },
          { key: 'memory', tokens: 21_000 },
          { key: 'chat', tokens: 936_000 },
        ],
        rawMaxTokens: 1_000_000,
        compactThreshold: 900_000,
      },
    })
    const worktrees = [
      { root: '/repo', worktree: null, branch: 'main' },
      { root: '/w/rich-statusline', worktree: 'rich-statusline', branch: 'feat/rich-statusline' },
      { root: `/w/${'w'.repeat(50)}`, worktree: 'w'.repeat(50), branch: `feat/${'b'.repeat(60)}` },
    ]
    const snaps = [
      heavy,
      ...worktrees.map(git =>
        buildSnapshot({
          ...FIXTURE,
          git: { ...git, diff: { insertions: 120, deletions: 30 } },
          pr: { label: '#12345', root: git.root, branch: git.branch },
          usage: { ...FIXTURE.usage!, costUsd: 123.45 },
        }),
      ),
    ]
    const columnsSwept = [60, 61, 65, 70, 75, 79, 80, 85, 90, 99, 100, 110, 120, 140, 160, 200]
    const over = snaps.flatMap((snap, index) =>
      columnsSwept.flatMap(columns =>
        (['1a', '1b', '1c'] as const).flatMap(layout =>
          rowsOf(draw(layout, columns, DEFAULT_SETTINGS, snap))
            .filter(row => [...row].length > columns)
            .map(row => `${layout} #${index} at ${columns}: ${[...row].length} ${row}`),
        ),
      ),
    )
    expect(over).toEqual([])
  })
  test('the 1c identity drops PR, then diff, then worktree, then truncates', () => {
    const snap = buildSnapshot({
      ...FIXTURE,
      git: { root: '/w/rich-statusline', worktree: 'rich-statusline', branch: 'feat/rich-statusline', diff: { insertions: 120, deletions: 30 } },
      pr: { label: '#12345', root: '/w/rich-statusline', branch: 'feat/rich-statusline' },
    })
    const row = (columns: number) => textOf(draw('1c', columns, DEFAULT_SETTINGS, snap)[1])
    const leftOf = (text: string) => text.replace(/ {2,}ctx \d+%.*$/, '')
    for (const columns of [97, 80, 60, 55]) expect([...row(columns)].length).toBe(columns)
    expect(leftOf(row(98))).toBe('Opus 5.5·med  ~/.l/workspace  wt rich-statusline feat/rich-statusline (+120,-30) · #12345')
    expect(leftOf(row(97))).toBe('Opus 5.5·med  ~/.l/workspace  wt rich-statusline feat/rich-statusline (+120,-30)')
    expect(leftOf(row(80))).toBe('Opus 5.5·med  ~/.l/workspace  wt rich-statusline feat/rich-statusline')
    expect(leftOf(row(60))).toBe('Opus 5.5·med  ~/.l/workspace  feat/rich-statusline')
    expect(row(55)).toBe('Opus 5.5·med  ~/.l/workspace  feat/rich-statu…  ctx 14%')
  })
  test('the 1a context row fits 60 columns with the heaviest figures', () => {
    const snap = buildSnapshot({ ...FIXTURE, usage: { ...FIXTURE.usage!, tokens: 1_050_000, window: 1_000_000 } })
    const rows = rowsOf(draw('1a', 60, DEFAULT_SETTINGS, snap))
    expect([...(rows[1] ?? '')].length).toBeLessThanOrEqual(60)
    expect(rows[1]?.startsWith('ctx  ')).toBe(true)
  })
  test('under 60 columns forces 1c', () => {
    const lines = draw('1a', 59)
    expect(textOf(lines[0])).toBe('▀'.repeat(59))
  })
})
