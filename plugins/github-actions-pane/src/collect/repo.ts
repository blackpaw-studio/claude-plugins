// The GitHub repository a checkout pushes to, read from git remotes: `gh repo
// view` picks `upstream` over `origin` in a fork clone and so watches someone
// else's runs. Local git reads only, no network.
//
// Order: a remote `gh repo set-default` marked, then the branch's push target,
// then origin. Only github.com URLs count (a GitHub Enterprise host, or an ssh
// alias for github.com, resolves nothing here and is left to `gh`).
import { type Run, type RunInit, tryRun } from './run'
import { trackingRefOf } from './remote-ref'

const GIT_TIMEOUT_MS = 10_000
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0' }
const DEFAULT_REMOTE = 'origin'
/** What `gh repo set-default` writes as `remote.<name>.gh-resolved` for the remote it picked. */
const GH_BASE = 'base'

// https://[user@]github.com/o/r[.git][/], ssh://git@github.com/o/r, git@github.com:o/r[.git], git://github.com/o/r
const GITHUB_URL = /^(?:(?:https?|ssh|git):\/\/)?(?:[^@/]+@)?(?:www\.)?github\.com[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/i

/** `owner/repo` of a github.com remote URL; null for any other host or shape. Pure. */
export const parseGitHubUrl = (url: string): string | null => {
  const match = GITHUB_URL.exec(url.trim())
  return match === null ? null : `${match[1]}/${match[2]}`
}

/** `git config --list` as key to value, a later entry replacing an earlier one. Keys: section and variable lowercased. */
const parseConfig = (stdout: string): ReadonlyMap<string, string> =>
  new Map(
    stdout.split('\n').flatMap((line): [string, string][] => {
      const at = line.indexOf('=')
      return at > 0 ? [[line.slice(0, at), line.slice(at + 1)]] : []
    }),
  )

const initOf = (cwd: string): RunInit => ({ cwd, timeoutMs: GIT_TIMEOUT_MS, env: GIT_ENV })

const remoteNames = (config: ReadonlyMap<string, string>): string[] =>
  [...config.keys()].flatMap(key => (/^remote\..+\.url$/.test(key) ? [key.slice('remote.'.length, -'.url'.length)] : []))

const repoOfRemote = (config: ReadonlyMap<string, string>, name: string): string | null => {
  const url = config.get(`remote.${name}.url`)
  return url === undefined ? null : parseGitHubUrl(url)
}

/** The repos named by `gh repo set-default`, in config order: a remote marked `base`, or `owner/repo` outright. */
const ghDefaults = (config: ReadonlyMap<string, string>): (string | null)[] =>
  [...config.entries()].flatMap(([key, value]) => {
    const name = /^remote\.(.+)\.gh-resolved$/.exec(key)?.[1]
    if (name === undefined) return []
    return [value === GH_BASE ? repoOfRemote(config, name) : /^[^/\s]+\/[^/\s]+$/.test(value) ? value : null]
  })

/** The remote a push of this branch goes to: the longest known remote name the push ref sits under. */
const pushRemoteOf = async (run: Run, cwd: string, branch: string | null, names: readonly string[]): Promise<string | null> => {
  if (branch === null) return null
  const target = await trackingRefOf(run, cwd, branch)
  if (!target.isConfigured) return null
  return [...names].sort((a, b) => b.length - a.length).find(name => target.ref.startsWith(`refs/remotes/${name}/`)) ?? null
}

/** `owner/repo` the checkout pushes to; null when git names no GitHub repo (the caller then asks gh). */
export const repoFromRemotes = async (run: Run, cwd: string, branch: string | null): Promise<string | null> => {
  const ran = await tryRun(run, ['git', 'config', '--list'], initOf(cwd))
  if (ran.kind !== 'ran' || ran.result.exitCode !== 0) return null
  const config = parseConfig(ran.result.stdout)
  const explicit = ghDefaults(config).find(repo => repo !== null)
  if (explicit !== undefined) return explicit
  const pushRemote = await pushRemoteOf(run, cwd, branch, remoteNames(config))
  const candidates = [pushRemote, DEFAULT_REMOTE].flatMap(name => (name === null ? [] : [repoOfRemote(config, name)]))
  return candidates.find(repo => repo !== null) ?? null
}
