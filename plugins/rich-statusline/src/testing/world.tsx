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
/** What the engine (beneath the plugin) draws in the band when we pass. */
export const ENGINE_BAND = 'engine band'

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
  usageCalls: () => number
  hintDraws: () => number
  stores: unknown[]
  storeReads: () => number
  /** Empties the session's `$.state` with no event, as a /clear leaves it (isStateScoped). */
  wipeState: () => void
}

export type WorldOptions = {
  branch?: string | null
  stored?: Record<string, unknown>
  isUsageBroken?: boolean
  /**
   * `$.state` held per session, as the engine holds it: a /clear's
   * `session.end` empties it. Nothing redraws on a write then: mount again to read.
   */
  isStateScoped?: boolean
  /** With isStateScoped: every write of the settings value is denied. */
  isSettingsRefused?: boolean
}

type Held = { value: unknown; version: number }

/** A session's `$.state`, answered beneath the plugin; `wipe` starts an empty one. */
const scopeState = (on: On, isSettingsRefused: boolean): (() => void) => {
  let held = new Map<string, Held>()
  const heldAt = (e: { plugin: string; key: string; id?: string }): [string, Held] => {
    const name = `${e.plugin}/${e.key}/${e.id ?? ''}`
    return [name, held.get(name) ?? { value: undefined, version: 0 }]
  }
  on('state.get', (_$, e) => ({ value: heldAt(e)[1] }) as never)
  on('state.set', (_$, e) => {
    if (isSettingsRefused && e.key === 'settings') return { deny: 'settings refused' }
    const [name, now] = heldAt(e)
    if (e.ifVersion !== undefined && e.ifVersion !== now.version) return { value: { isSet: false, version: now.version } } as never
    held.set(name, { value: e.value, version: now.version + 1 })
    return { value: { isSet: true, version: now.version + 1 } } as never
  })
  const wipe = () => {
    held = new Map()
  }
  on('session.end', (_$, e) => {
    if (e.reason === 'clear') wipe()
    return { sessionId: e.sessionId }
  })
  return wipe
}

/** Installs the session beneath the plugin; returns what the test reads back. */
export const installWorld = (
  on: On,
  { branch = null, stored = {}, isUsageBroken = false, isStateScoped = false, isSettingsRefused = false }: WorldOptions = {},
): World => {
  const wipeState = isStateScoped ? scopeState(on, isSettingsRefused) : () => undefined
  const stores: unknown[] = []
  let storeReads = 0
  const memory = new Map<string, unknown>(Object.entries(stored))
  on('store.get', (_$, e) => ((storeReads += 1), { value: memory.get(e.key) }))
  on('store.set', (_$, e) => {
    stores.push(e)
    memory.set(e.key, e.value)
    return { value: undefined }
  })
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/Users/evan' })
  const runs: string[] = []
  let usageCount = 0
  let hintDraws = 0
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: '/Users/evan/.leo/workspace' }))
  on('settings.read', () => ({ value: { effortLevel: 'medium' } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
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
    if (branch === null) return { value: { ...done, exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' } }
    const command = e.argv.join(' ')
    const stdout = command.includes('--show-toplevel')
      ? '/Users/evan/.leo/workspace\n'
      : command.includes('--git-common-dir')
        ? '/Users/evan/.leo/workspace/.git\n/Users/evan/.leo/workspace/.git\n'
      : command.includes('--abbrev-ref')
        ? `${branch}\n`
        : e.argv[0] === 'gh'
          ? '{"number":123,"state":"OPEN"}'
          : ' 2 files changed, 12 insertions(+), 3 deletions(-)\n'
    return { value: { ...done, exitCode: 0, stdout } }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine-band">{ENGINE_BAND}</Text>
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    hintDraws += 1
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })
  return { clock, runs, stores, usageCalls: () => usageCount, hintDraws: () => hintDraws, storeReads: () => storeReads, wipeState }
}

export const PROMPT_HINT = {
  component: 'PromptHint' as const,
  props: { isDraft: false, isWorking: false, hint: ENGINE_HINT },
}

export const SETTINGS_BAND = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 95,
    scroll: { offset: 0, bodyRows: 11 },
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
