// The engine beneath the plugin in hook tests: a session in a git repo with
// the design fixture's usage, answered from memory.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export const NOW = 1_800_000_000_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const SLACK = 30_000

export const ENGINE_HINT = '? for shortcuts'

export const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 6_400, kind: 'used', color: 'promptBorder', isDeferred: false },
    { name: 'System tools', tokens: 8_200, kind: 'used', color: 'inactive', isDeferred: false },
    { name: 'MCP tools', tokens: 3_000, kind: 'used', color: 'permission', isDeferred: false },
    { name: 'Memory files', tokens: 1_600, kind: 'used', color: 'claude', isDeferred: false },
    { name: 'Messages', tokens: 8_800, kind: 'used', color: 'success', isDeferred: false },
    { name: 'Free space', tokens: 142_000, kind: 'free', color: 'inactive', isDeferred: false },
    { name: 'Autocompact buffer', tokens: 30_000, kind: 'buffer', color: 'inactive', isDeferred: false },
  ],
  totalTokens: 28_000,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'auto',
  percentage: 14,
  gridRows: [],
  model: 'claude-opus-5-5',
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  autoCompactThreshold: 170_000,
  isAutoCompactEnabled: true,
  apiUsage: null,
}

export const RATE_LIMITS = [
  { kind: 'five_hour', percentUsed: 10, resetsAt: new Date(NOW + HOUR + 11 * MINUTE + SLACK).toISOString() },
  { kind: 'seven_day', percentUsed: 75, resetsAt: new Date(NOW + DAY + 12 * HOUR + 11 * MINUTE + SLACK).toISOString() },
]

export type World = {
  clock: ReturnType<typeof mock.clock>
  runs: string[]
  opened: unknown[]
  usageCalls: () => number
  stores: unknown[]
}

export type WorldOptions = { branch?: string | null; stored?: Record<string, unknown>; isUsageBroken?: boolean }

/** Installs the session beneath the plugin; returns what the test reads back. */
export const installWorld = (on: On, { branch = null, stored = {}, isUsageBroken = false }: WorldOptions = {}): World => {
  const stores: unknown[] = []
  const memory = new Map<string, unknown>(Object.entries(stored))
  on('store.get', (_$, e) => ({ value: memory.get(e.key) }))
  on('store.set', (_$, e) => {
    stores.push(e)
    memory.set(e.key, e.value)
    return { value: undefined }
  })
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/Users/evan' })
  const runs: string[] = []
  const opened: unknown[] = []
  let usageCount = 0
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: '/Users/evan/.leo/workspace' }))
  on('settings.read', () => ({ value: { effortLevel: 'medium' } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => {
    usageCount += 1
    if (isUsageBroken) return { deny: 'no session bound' }
    return {
      value: {
        startedAt: NOW,
        context: { tokens: 28_000, window: 200_000, percent: 14, breakdown: BREAKDOWN },
        rateLimits: RATE_LIMITS,
      },
    } as never
  })
  on('process.run', (_$, e) => {
    runs.push(e.argv.join(' '))
    const done = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (branch === null) return { value: { ...done, exitCode: 128, stdout: '' } }
    const command = e.argv.join(' ')
    const stdout = command.includes('--show-toplevel')
      ? '/Users/evan/.leo/workspace\n'
      : command.includes('--abbrev-ref')
        ? `${branch}\n`
        : e.argv[0] === 'gh'
          ? '{"number":123,"state":"OPEN"}'
          : ' 2 files changed, 12 insertions(+), 3 deletions(-)\n'
    return { value: { ...done, exitCode: 0, stdout } }
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })
  return { clock, runs, opened, stores, usageCalls: () => usageCount }
}

export const PROMPT_HINT = {
  component: 'PromptHint' as const,
  props: { isDraft: false, isWorking: false, hint: ENGINE_HINT },
}

export const SETTINGS_PANE = {
  component: 'Pane' as const,
  requestId: 'rich-statusline-settings',
  props: {
    title: 'Rich statusline',
    isFocused: true,
    bodyColumns: 80,
    placement: 'inline' as const,
    scroll: { offset: 0, bodyRows: 14 },
    view: {},
  },
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string

/** The text a drawn node shows, its string children in order. */
export const textOfNode = (node: unknown): string => {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  const children = (node as Exclude<Node, string> | null)?.children ?? []
  return children.map(textOfNode).join('')
}

/** The rows of a drawn status tree: each child of the root column. */
export const rowsOfTree = (tree: unknown): unknown[] => (tree as { children?: unknown[] }).children ?? []
