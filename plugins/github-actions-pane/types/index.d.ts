// The $.state contract of github-actions-pane: what its poller collects and its pane
// draws. Self-contained (no imports), named in plugin.json.

/** Which runs the pane watches: HEAD's commit, the current branch, or the whole repo. */
export type ActionsScope = 'commit' | 'branch' | 'repo'

/** One step of a job, times in epoch milliseconds (null: not started / not finished). */
export type ActionsStep = {
  name: string
  number: number
  /** `queued`, `in_progress`, `completed`, `pending`, `waiting`… as GitHub spells it. */
  status: string
  /** Set once completed: `success`, `failure`, `skipped`, `cancelled`…; null before. */
  conclusion: string | null
  startedAt: number | null
  completedAt: number | null
}

export type ActionsJob = {
  id: number
  name: string
  status: string
  conclusion: string | null
  startedAt: number | null
  completedAt: number | null
  url: string
  steps: ActionsStep[]
}

export type ActionsRun = {
  id: number
  /** The run number within its workflow (`#482`). */
  number: number
  workflow: string
  /** The commit or PR title GitHub shows for the run. */
  title: string
  event: string
  status: string
  conclusion: string | null
  branch: string
  sha: string
  createdAt: number
  startedAt: number | null
  updatedAt: number
  url: string
}

/** Where the session stands: the branch (null when detached), HEAD, and the repo. */
export type ActionsContext = {
  cwd: string
  branch: string | null
  sha: string | null
  /** `owner/repo` as gh resolves it. */
  repo: string
}

export type ActionsData = {
  /** Null until the first context check settles, or while disabled. */
  context: ActionsContext | null
  /** The latest list in scope, newest first. */
  runs: ActionsRun[]
  /** Jobs by run id, for the runs that are shown. */
  jobs: Record<string, ActionsJob[]>
  /**
   * Runs seen active while watched, by id: null while active, else the local
   * time their completion was first seen (the linger window counts from it).
   */
  watched: Record<string, number | null>
  /** Local time of the last successful list; null before one. */
  fetchedAt: number | null
  /** The interval the poller runs at now, for the stale check. */
  pollMs: number
  /** The last list was refused by GitHub's rate limit. */
  isRateLimited: boolean
  /** Why the mod is idle (not a repo, no gh…); null when it is watching. */
  disabled: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'github-actions-pane': {
      data: ActionsData | null
      /** The clock the pane draws durations and the spinner from, ticked while open. */
      now: number
      /** This session's `/actions <scope>` choice; null follows the setting. */
      scope: ActionsScope | null
      /** The pane was opened by `/actions` (no auto-close, shows the latest run when idle). */
      isManual: boolean
    }
  }
}
