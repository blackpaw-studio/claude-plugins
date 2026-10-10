import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_SETTINGS, parseSettings } from './settings'

describe('parseSettings', () => {
  test('the manifest defaults', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS).toEqual({ scope: 'branch', lingerMs: 30_000, activePollMs: 10_000, idlePollMs: 60_000, autoOpen: false })
  })
  test('reads each option in seconds', () => {
    expect(parseSettings({ scope: 'repo', lingerSeconds: 0, activePollSeconds: 6, idlePollSeconds: 120, autoOpen: false })).toEqual({
      scope: 'repo',
      lingerMs: 0,
      activePollMs: 6_000,
      idlePollMs: 120_000,
      autoOpen: false,
    })
  })
  test('holds the poll floors (5s active, 15s idle) and drops junk', () => {
    expect(parseSettings({ activePollSeconds: 1, idlePollSeconds: 2 })).toMatchObject({ activePollMs: 5_000, idlePollMs: 15_000 })
    expect(parseSettings({ scope: 'org', lingerSeconds: -3, activePollSeconds: 'fast' })).toMatchObject({
      scope: 'branch',
      lingerMs: 0,
      activePollMs: 10_000,
    })
  })
})
