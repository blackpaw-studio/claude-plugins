// The local remote-tracking ref of the branch the pane watches: a push from
// any terminal moves it, so a change is a push. Local git reads only, no
// network. `git rev-parse` resolves loose refs, packed-refs and worktrees alike.
import { type Run, type RunInit, tryRun } from './run'

const GIT_TIMEOUT_MS = 10_000
/** git reads only: never refresh the index (no index.lock fights with commits). */
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0' }
const DEFAULT_REMOTE = 'origin'

/** `ok` with the sha, or null while the ref does not exist; `unknown` when git could not say. */
export type RefRead = { kind: 'ok'; sha: string | null } | { kind: 'unknown' }

const initOf = (cwd: string): RunInit => ({ cwd, timeoutMs: GIT_TIMEOUT_MS, env: GIT_ENV })

/** The ref a push of this branch updates: its push target, else origin's. */
export const trackingRefOf = async (run: Run, cwd: string, branch: string): Promise<string> => {
  const ran = await tryRun(run, ['git', 'rev-parse', '--symbolic-full-name', '@{push}'], initOf(cwd))
  const ref = ran.kind === 'ran' && ran.result.exitCode === 0 ? ran.result.stdout.trim() : ''
  return ref === '' ? `refs/remotes/${DEFAULT_REMOTE}/${branch}` : ref
}

export const readRef = async (run: Run, cwd: string, ref: string): Promise<RefRead> => {
  const ran = await tryRun(run, ['git', 'rev-parse', '--verify', '-q', ref], initOf(cwd))
  if (ran.kind === 'failed') return { kind: 'unknown' }
  const { exitCode, stdout } = ran.result
  if (exitCode === 0) return { kind: 'ok', sha: stdout.trim() || null }
  // `--verify -q` exits 1 and prints nothing for a ref that is not there.
  return exitCode === 1 ? { kind: 'ok', sha: null } : { kind: 'unknown' }
}
