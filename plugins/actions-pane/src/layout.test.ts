import { describe, expect, test } from 'claude-code/testing'
import { type Card, type Snapshot } from './snapshot'
import { layoutPane } from './layout'
import { type Line, textOf } from './line'
import { SECOND } from './testing/builders'

const MINUTE = 60 * SECOND

const CI: Card = {
  id: 482,
  status: 'running',
  name: 'CI #482',
  event: 'push',
  href: 'https://github.com/acme/widgets/actions/runs/482',
  subtitle: 'fix: parser edge case · a1b2c3d',
  durationMs: MINUTE + 12 * SECOND,
  isActive: true,
  rows: [
    { depth: 0, status: 'success', name: 'lint', durationMs: 18 * SECOND },
    { depth: 0, status: 'running', name: 'test (node 20)', durationMs: MINUTE + 4 * SECOND },
    { depth: 1, status: 'success', name: 'Set up job', durationMs: 2 * SECOND },
    { depth: 1, status: 'success', name: 'Checkout', durationMs: SECOND },
    { depth: 1, status: 'running', name: 'Run tests', durationMs: 42 * SECOND },
    { depth: 1, status: 'queued', name: 'Post checkout', durationMs: null },
    { depth: 0, status: 'queued', name: 'build', durationMs: null },
  ],
}

const DEPLOY: Card = {
  id: 77,
  status: 'failure',
  name: 'Deploy #77',
  event: 'push',
  href: 'https://github.com/acme/widgets/actions/runs/77',
  subtitle: 'fix: parser edge case · a1b2c3d',
  durationMs: 3 * MINUTE + 2 * SECOND,
  isActive: false,
  rows: [
    { depth: 0, status: 'failure', name: 'deploy', durationMs: 2 * MINUTE + 50 * SECOND },
    { depth: 1, status: 'failure', name: 'Upload artifacts', durationMs: 31 * SECOND },
  ],
}

const snapshotOf = (cards: Card[], fields: Partial<Snapshot> = {}): Snapshot => ({
  label: 'main',
  note: null,
  cards,
  counts: { running: 0, failed: 0, passed: 0 },
  activeIds: [],
  shownIds: cards.map(card => card.id),
  ...fields,
})

const texts = (lines: readonly Line[]): string[] => lines.map(textOf)
const ROOMY = { width: 43, rows: 40, frame: 0 }

describe('layoutPane', () => {
  test("draws the spec's run view: cards, jobs, steps, durations right-aligned", () => {
    expect(texts(layoutPane(snapshotOf([CI, DEPLOY]), ROOMY))).toEqual([
      'GitHub Actions · main',
      ' ',
      '◐ CI #482 · push                     1m 12s',
      '  fix: parser edge case · a1b2c3d',
      '  ✓ lint                                18s',
      '  ◐ test (node 20)                   1m 04s',
      '    ✓ Set up job                         2s',
      '    ✓ Checkout                           1s',
      '    ⠋ Run tests                         42s',
      '    ○ Post checkout',
      '  ○ build',
      ' ',
      '✗ Deploy #77 · push                  3m 02s',
      '  fix: parser edge case · a1b2c3d',
      '  ✗ deploy                           2m 50s',
      '    ✗ Upload artifacts                  31s',
    ])
  })

  test('the run name is a link; glyphs carry theme colours', () => {
    const [, , runRow = [], , lintRow = []] = layoutPane(snapshotOf([CI]), ROOMY)
    expect(runRow).toContainEqual({ text: 'CI #482', bold: true, href: CI.href })
    expect(runRow[0]).toEqual({ text: '◐', color: 'warning' })
    expect(lintRow).toContainEqual({ text: '✓', color: 'success' })
  })

  test('the spinner turns with the frame', () => {
    const at = (frame: number) => texts(layoutPane(snapshotOf([CI]), { ...ROOMY, frame }))[8]
    expect(at(1)).toBe('    ⠙ Run tests                         42s')
    expect(at(2)).toBe('    ⠹ Run tests                         42s')
  })

  test('names truncate with … to keep the duration; the event goes first', () => {
    const lines = texts(layoutPane(snapshotOf([CI]), { ...ROOMY, width: 24 }))
    expect(lines[2]).toBe('◐ CI #482 · push  1m 12s')
    expect(lines[3]).toBe('  fix: parser edge case…')
    expect(lines[5]).toBe('  ◐ test (node 2… 1m 04s')
    const narrower = texts(layoutPane(snapshotOf([CI]), { ...ROOMY, width: 16 }))
    expect(narrower[2]).toBe('◐ CI #482 1m 12s')
    expect(narrower.every(line => [...line].length <= 16)).toBe(true)
  })

  test('the note sits at the right of the header', () => {
    const [header] = texts(layoutPane(snapshotOf([CI], { note: 'stale · 40s' }), ROOMY))
    expect(header).toBe(`GitHub Actions · main${' '.repeat(11)}stale · 40s`)
  })

  test('with no runs to show, says so', () => {
    expect(texts(layoutPane(snapshotOf([]), ROOMY))).toEqual(['GitHub Actions · main', ' ', 'No workflow runs for main'])
    const idle = texts(layoutPane(snapshotOf([], { label: '', note: 'no GitHub remote' }), ROOMY))
    expect(idle).toEqual([`GitHub Actions${' '.repeat(13)}no GitHub remote`])
  })

  test('overflow drops the oldest finished cards first', () => {
    const older: Card = { ...DEPLOY, id: 76, name: 'Deploy #76' }
    const lines = texts(layoutPane(snapshotOf([CI, DEPLOY, older]), { ...ROOMY, rows: 16 }))
    expect(lines).toHaveLength(16)
    expect(lines.some(line => line.includes('Deploy #77'))).toBe(true)
    expect(lines.some(line => line.includes('Deploy #76'))).toBe(false)
  })

  test('then cuts cards and says how many more', () => {
    const second: Card = { ...CI, id: 483, name: 'CI #483' }
    const lines = texts(layoutPane(snapshotOf([CI, second, DEPLOY]), { ...ROOMY, rows: 12 }))
    expect(lines).toHaveLength(12)
    expect(lines[11]).toBe('+2 more')
    expect(lines.some(line => line.includes('CI #483'))).toBe(false)
  })

  test('a card taller than the pane is cut row by row', () => {
    const lines = texts(layoutPane(snapshotOf([CI]), { ...ROOMY, rows: 6 }))
    expect(lines).toEqual([
      'GitHub Actions · main',
      ' ',
      '◐ CI #482 · push                     1m 12s',
      '  fix: parser edge case · a1b2c3d',
      '  ✓ lint                                18s',
      '+6 more rows',
    ])
  })
})
