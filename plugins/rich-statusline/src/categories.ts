// Folds /context's breakdown rows into the five categories the bar draws.
import type { RichStatuslineCategory, RichStatuslineCategoryKey } from '../types'

export type BreakdownRow = { name: string; tokens: number; kind: string }

export const CATEGORY_ORDER: readonly RichStatuslineCategoryKey[] = ['system', 'tools', 'mcp', 'memory', 'chat']

const BY_NAME: Readonly<Record<string, RichStatuslineCategoryKey>> = {
  'System prompt': 'system',
  'System tools': 'tools',
  Skills: 'tools',
  'Custom agents': 'tools',
  'Slash commands': 'tools',
  'MCP tools': 'mcp',
  'Memory files': 'memory',
  Messages: 'chat',
}

const keyFor = (name: string): RichStatuslineCategoryKey => BY_NAME[name] ?? 'tools'

export const foldCategories = (rows: readonly BreakdownRow[]): RichStatuslineCategory[] => {
  const used = rows.filter(row => row.kind === 'used')
  return CATEGORY_ORDER.map(key => ({
    key,
    tokens: used.filter(row => keyFor(row.name) === key).reduce((total, row) => total + Math.max(0, row.tokens), 0),
  }))
}
