import { describe, expect, test } from 'claude-code/testing'
import { foldCategories } from './categories'

const row = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer' | 'deferred' = 'used') => ({
  name,
  tokens,
  kind,
})

describe('foldCategories', () => {
  test('folds the /context rows into five in display order', () => {
    const folded = foldCategories([
      row('System prompt', 6_400),
      row('System tools', 5_000),
      row('Skills', 1_200),
      row('Custom agents', 1_000),
      row('Slash commands', 1_000),
      row('MCP tools', 3_000),
      row('Memory files', 1_600),
      row('Messages', 8_800),
      row('Free space', 172_000, 'free'),
      row('Autocompact buffer', 30_000, 'buffer'),
      row('MCP tools (deferred)', 9_000, 'deferred'),
    ])
    expect(folded).toEqual([
      { key: 'system', tokens: 6_400 },
      { key: 'tools', tokens: 8_200 },
      { key: 'mcp', tokens: 3_000 },
      { key: 'memory', tokens: 1_600 },
      { key: 'chat', tokens: 8_800 },
    ])
  })
  test('unknown categories count as tools', () => {
    const folded = foldCategories([row('Hologram widgets', 700)])
    expect(folded.find(c => c.key === 'tools')?.tokens).toBe(700)
  })
  test('empty input yields five zero rows', () => {
    expect(foldCategories([]).map(c => c.tokens)).toEqual([0, 0, 0, 0, 0])
  })
})
