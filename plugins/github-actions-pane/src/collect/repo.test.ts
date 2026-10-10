import { describe, expect, test } from 'claude-code/testing'
import { fail, ok, runner } from '../testing/runner'
import { parseGitHubUrl, repoFromRemotes } from './repo'

const CONFIG = 'git config --list'
const PUSH = 'git rev-parse --symbolic-full-name @{push}'
const NO_PUSH = fail('fatal: The current branch main has no upstream branch.', 128)

const FORK_CONFIG = [
  'user.name=Evan',
  'remote.upstream.url=https://github.com/ghostty-org/ghostty.git',
  'remote.upstream.fetch=+refs/heads/*:refs/remotes/upstream/*',
  'remote.origin.url=git@github.com:blackpaw-studio/leoterm.git',
  'remote.origin.fetch=+refs/heads/*:refs/remotes/origin/*',
  'branch.main.remote=origin',
].join('\n')

const resolve = (config: string, branch: string | null, push = NO_PUSH) =>
  repoFromRemotes(runner({ [CONFIG]: ok(`${config}\n`), [PUSH]: push }).run, '/repo', branch)

describe('repoFromRemotes', () => {
  test('a fork clone with no push target watches origin, not the upstream gh would pick', async () => {
    expect(await resolve(FORK_CONFIG, 'main')).toBe('blackpaw-studio/leoterm')
  })

  test('the push target of the branch wins over origin', async () => {
    const config = `${FORK_CONFIG}\nremote.mine.url=https://github.com/evan/leoterm\nbranch.feat/x.pushremote=mine`
    expect(await resolve(config, 'feat/x', ok('refs/remotes/mine/feat/x\n'))).toBe('evan/leoterm')
  })

  test('a push target is told from the ref by remote name, slashes in either', async () => {
    const config = 'remote.team/fork.url=git@github.com:team/fork.git\nremote.origin.url=git@github.com:a/b.git'
    expect(await resolve(config, 'feat/x', ok('refs/remotes/team/fork/feat/x\n'))).toBe('team/fork')
  })

  test("an explicit gh default (`gh repo set-default`) wins over the push target and origin", async () => {
    const config = `${FORK_CONFIG}\nremote.upstream.gh-resolved=base`
    expect(await resolve(config, 'main', ok('refs/remotes/origin/main\n'))).toBe('ghostty-org/ghostty')
  })

  test('a gh default that names owner/repo outright is used as is', async () => {
    const config = `${FORK_CONFIG}\nremote.origin.gh-resolved=acme/widgets`
    expect(await resolve(config, 'main')).toBe('acme/widgets')
  })

  test('a push target that is not on GitHub falls through to origin', async () => {
    const config = `${FORK_CONFIG}\nremote.corp.url=git@git.corp.example:team/app.git`
    expect(await resolve(config, 'main', ok('refs/remotes/corp/main\n'))).toBe('blackpaw-studio/leoterm')
  })

  test('a detached HEAD skips the push target and does not ask for it', async () => {
    const { run, asked } = runner({ [CONFIG]: ok(`${FORK_CONFIG}\n`) })
    expect(await repoFromRemotes(run, '/repo', null)).toBe('blackpaw-studio/leoterm')
    expect(asked.map(one => one.argv)).toEqual([CONFIG])
  })

  test('reads git only, in the cwd, never refreshing the index', async () => {
    const { run, asked } = runner({ [CONFIG]: ok(`${FORK_CONFIG}\n`), [PUSH]: NO_PUSH })
    await repoFromRemotes(run, '/repo', 'main')
    expect(asked.map(one => one.init)).toEqual(Array(2).fill({ cwd: '/repo', timeoutMs: 10_000, env: { GIT_OPTIONAL_LOCKS: '0' } }))
  })

  test('no GitHub remote, or git that fails, resolves nothing (the caller asks gh)', async () => {
    expect(await resolve('remote.corp.url=git@git.corp.example:team/app.git', 'main')).toBeNull()
    expect(await resolve('', 'main')).toBeNull()
    expect(await repoFromRemotes(runner({ [CONFIG]: fail('fatal: not in a git directory', 128) }).run, '/repo', 'main')).toBeNull()
    expect(await repoFromRemotes(runner({ [CONFIG]: new Error('spawn git ENOENT') }).run, '/repo', 'main')).toBeNull()
  })
})

describe('parseGitHubUrl', () => {
  test('reads owner/repo from the https, ssh and scp forms, with or without .git', () => {
    const forms: [string, string][] = [
      ['https://github.com/cli/cli', 'cli/cli'],
      ['https://github.com/cli/cli.git', 'cli/cli'],
      ['https://github.com/cli/cli/', 'cli/cli'],
      ['https://user:token@github.com/cli/cli.git', 'cli/cli'],
      ['http://www.github.com/cli/cli', 'cli/cli'],
      ['git@github.com:cli/cli.git', 'cli/cli'],
      ['git@github.com:cli/cli', 'cli/cli'],
      ['ssh://git@github.com/cli/cli.git', 'cli/cli'],
      ['git://github.com/cli/cli.git', 'cli/cli'],
      ['https://GitHub.com/Cli/Cli.git', 'Cli/Cli'],
      ['https://github.com/cli/cli.js.git', 'cli/cli.js'],
    ]
    expect(forms.map(([url]) => parseGitHubUrl(url))).toEqual(forms.map(([, repo]) => repo))
  })

  test('any other host, or a URL that is not a repo, is null', () => {
    const urls = [
      'https://gitlab.com/cli/cli.git',
      'https://github.example.com/cli/cli.git',
      'https://notgithub.com/cli/cli.git',
      'https://github.com/cli',
      'https://github.com/cli/cli/pull/1',
      '/srv/git/cli.git',
      '',
    ]
    expect(urls.map(parseGitHubUrl)).toEqual(urls.map(() => null))
  })
})
