// The design artifact's fixture: Opus 5.5, medium, 28k/200k split
// 6.4/8.2/3.0/1.6/8.8, 5h 10% resetting in 1h11m, week 75% in 1d12h11m.
import type {
  RichStatuslineBreakdown,
  RichStatuslineGit,
  RichStatuslineIdentity,
  RichStatuslinePr,
  RichStatuslineUsage,
} from '../../types'
import { DEFAULT_SETTINGS } from '../settings'
import type { SnapshotInputs } from '../snapshot'

export const NOW = 1_800_000_000_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const SLACK = 30_000

export const IDENTITY: RichStatuslineIdentity = {
  model: 'claude-opus-5-5',
  effort: 'medium',
  cwd: '/Users/evan/.leo/workspace',
  home: '/Users/evan',
}

export const NO_GIT: RichStatuslineGit = { root: null, branch: null, diff: null }
export const NO_PR: RichStatuslinePr = { label: null, root: null, branch: null }

export const USAGE: RichStatuslineUsage = {
  tokens: 28_000,
  window: 200_000,
  rateLimits: [
    { kind: 'five_hour', percentUsed: 10, resetsAt: NOW + HOUR + 11 * MINUTE + SLACK },
    { kind: 'seven_day', percentUsed: 75, resetsAt: NOW + DAY + 12 * HOUR + 11 * MINUTE + SLACK },
  ],
}

export const BREAKDOWN: RichStatuslineBreakdown = {
  categories: [
    { key: 'system', tokens: 6_400 },
    { key: 'tools', tokens: 8_200 },
    { key: 'mcp', tokens: 3_000 },
    { key: 'memory', tokens: 1_600 },
    { key: 'chat', tokens: 8_800 },
  ],
  rawMaxTokens: 200_000,
  compactFraction: 0.85,
}

export const FIXTURE: SnapshotInputs = {
  identity: IDENTITY,
  git: NO_GIT,
  pr: NO_PR,
  usage: USAGE,
  breakdown: BREAKDOWN,
  settings: DEFAULT_SETTINGS,
  now: NOW,
}
