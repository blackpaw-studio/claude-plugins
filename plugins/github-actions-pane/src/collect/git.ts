// HEAD's sha and branch through an injected runner: the context every poll
// scopes its run list by.
import { type Run, type RunInit, tryRun } from './run'

const GIT_TIMEOUT_MS = 10_000
/** git reads only: never refresh the index (no index.lock fights with commits). */
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0' }
const NOT_A_REPO = /not a git repository/i
const UNBORN = /ambiguous argument 'HEAD'|unknown revision/i

export type Head =
  | { kind: 'ok'; sha: string | null; branch: string | null }
  | { kind: 'fatal'; reason: string }
  | { kind: 'transient'; reason: string }

const lineOf = (text: string): string => text.trim().split('\n')[0] ?? ''

/** `rev-parse HEAD --abbrev-ref HEAD` prints the sha, then the branch (`HEAD` when detached). */
export const collectHead = async (run: Run, cwd: string): Promise<Head> => {
  const init: RunInit = { cwd, timeoutMs: GIT_TIMEOUT_MS, env: GIT_ENV }
  const ran = await tryRun(run, ['git', 'rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'], init)
  if (ran.kind === 'failed') return { kind: 'transient', reason: ran.message }
  const { exitCode, stdout, stderr } = ran.result
  if (exitCode === 0) {
    const [sha = '', branch = ''] = stdout.trim().split('\n').map(line => line.trim())
    return { kind: 'ok', sha: sha === '' ? null : sha, branch: branch === '' || branch === 'HEAD' ? null : branch }
  }
  if (NOT_A_REPO.test(stderr)) return { kind: 'fatal', reason: 'not a git repository' }
  if (!UNBORN.test(stderr)) return { kind: 'transient', reason: lineOf(stderr) }
  const symbolic = await tryRun(run, ['git', 'symbolic-ref', '--short', 'HEAD'], init)
  if (symbolic.kind === 'failed' || symbolic.result.exitCode !== 0) return { kind: 'ok', sha: null, branch: null }
  return { kind: 'ok', sha: null, branch: lineOf(symbolic.result.stdout) || null }
}
