// The $.state contract of rich-statusline: the values its hooks collect and
// its render hook reads. Self-contained (no imports), named in plugin.json.

export type RichStatuslineLayout = '1a' | '1b' | '1c'

export type RichStatuslineSettings = {
  layout: RichStatuslineLayout
  showCost: boolean
  showPr: boolean
  showDiff: boolean
  showLegend: boolean
  amberPercent: number
  redPercent: number
  gitRefreshSeconds: number
  prRefreshSeconds: number
}

export type RichStatuslineDiff = { insertions: number; deletions: number }

export type RichStatuslineGit = {
  /** The repository's top-level folder; null outside a repository. */
  root: string | null
  /** Current branch (short sha when detached); null outside a repository. */
  branch: string | null
  /** Uncommitted changes against HEAD ((+0,-0) when clean); null outside a repo or before a first commit. */
  diff: RichStatuslineDiff | null
}

export type RichStatuslinePr = {
  /** `#123` style label; null when there is no PR or gh is unavailable. */
  label: string | null
  /** The repository root and branch the label was read for. */
  root: string | null
  branch: string | null
}

export type RichStatuslineIdentity = {
  /** Model id as the engine reports it. */
  model: string
  /** Effort level; absent when unknown or the model has none. */
  effort?: string
  cwd: string
  home?: string
}

export type RichStatuslineRateLimit = {
  kind: string
  percentUsed: number
  /** Reset time in epoch milliseconds. */
  resetsAt?: number
}

export type RichStatuslineUsage = {
  /** Input tokens of the last response; absent before the first one. */
  tokens?: number
  window: number
  rateLimits: RichStatuslineRateLimit[]
  costUsd?: number
}

export type RichStatuslineCategoryKey = 'system' | 'tools' | 'mcp' | 'memory' | 'chat'

export type RichStatuslineCategory = { key: RichStatuslineCategoryKey; tokens: number }

export type RichStatuslineBreakdown = {
  /** The five folded categories, in display order. */
  categories: RichStatuslineCategory[]
  /** The compaction window the breakdown measures against (not the bar's window). */
  rawMaxTokens: number
  /** Tokens at which auto-compaction runs; absent when it is off. */
  compactThreshold?: number
}

declare module 'claude-code' {
  interface PluginState {
    'rich-statusline': {
      settings: RichStatuslineSettings | null
      git: RichStatuslineGit | null
      pr: RichStatuslinePr | null
      identity: RichStatuslineIdentity | null
      usage: RichStatuslineUsage | null
      breakdown: RichStatuslineBreakdown | null
      now: number
      /** Whether the settings menu is open in the band above the prompt. */
      settingsOpen: boolean
    }
  }
}
