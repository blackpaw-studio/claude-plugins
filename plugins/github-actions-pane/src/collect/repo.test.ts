import { describe, expect, test } from 'claude-code/testing'
import { fail, ok, runner } from '../testing/runner'
import { parseGitHubUrl, repoFromRemotes } from './repo'

const CONFIG = 'git config --list'

const FORK_CONFIG = [
  'user.name=Evan',
  'remote.upstream.url=https://github.com/ghostty-org/ghostty.git',
  'remote.upstream.fetch=+refs/heads/*:refs/remotes/upstream/*',
  'remote.origin.url=git@github.com:blackpaw-studio/leoterm.git',
  'remote.origin.fetch=+refs/heads/*:refs/remotes/origin/*',
  'branch.main.remote=origin',
].join('\n')

const resolve = (config: string, branch: string | null) => repoFromRemotes(runner({ [CONFIG]: ok(`${config}\n`) }).run, '/repo', branch)

describe('repoFromRemotes', () => {
  test('a fork clone with no push target watches origin, not the upstream gh would pick', async () => {
    expect(await resolve(FORK_CONFIG, 'main')).toBe('blackpaw-studio/leoterm')
  })

  test('the branch pushRemote wins over origin, with no tracking ref to its name yet', async () => {
    const config = `${FORK_CONFIG}\nremote.mine.url=https://github.com/evan/leoterm\nbranch.feat/x.pushremote=mine`
    expect(await resolve(config, 'feat/x')).toBe('evan/leoterm')
  })

  test('remote.pushDefault applies to a branch with no pushRemote of its own', async () => {
    const config = `${FORK_CONFIG}\nremote.mine.url=https://github.com/evan/leoterm\nremote.pushdefault=mine`
    expect(await resolve(config, 'main')).toBe('evan/leoterm')
  })

  test('the remote a branch tracks is where it pushes when nothing else says', async () => {
    const config = `${FORK_CONFIG}\nbranch.main.remote=upstream`
    expect(await resolve(config, 'main')).toBe('ghostty-org/ghostty')
  })

  test('pushRemote beats pushDefault, which beats the tracked remote', async () => {
    const config = [
      'remote.a.url=git@github.com:o/a.git',
      'remote.b.url=git@github.com:o/b.git',
      'remote.c.url=git@github.com:o/c.git',
      'remote.pushdefault=b',
      'branch.main.remote=c',
    ].join('\n')
    expect(await resolve(config, 'main')).toBe('o/b')
    expect(await resolve(`${config}\nbranch.main.pushremote=a`, 'main')).toBe('o/a')
  })

  test("another branch's settings do not apply", async () => {
    const config = `${FORK_CONFIG}\nremote.mine.url=https://github.com/evan/leoterm\nbranch.other.pushremote=mine`
    expect(await resolve(config, 'main')).toBe('blackpaw-studio/leoterm')
  })

  test("an explicit gh default (`gh repo set-default`) wins over the push target and origin", async () => {
    const config = `${FORK_CONFIG}\nremote.upstream.gh-resolved=base`
    expect(await resolve(config, 'main')).toBe('ghostty-org/ghostty')
  })

  test('a gh default that names owner/repo outright is used as is', async () => {
    const config = `${FORK_CONFIG}\nremote.origin.gh-resolved=acme/widgets`
    expect(await resolve(config, 'main')).toBe('acme/widgets')
  })

  test('a push target that is not on GitHub falls through to origin', async () => {
    const config = `${FORK_CONFIG}\nremote.corp.url=git@git.corp.example:team/app.git\nbranch.main.pushremote=corp`
    expect(await resolve(config, 'main')).toBe('blackpaw-studio/leoterm')
  })

  test('a detached HEAD has no branch settings: pushDefault, else origin', async () => {
    const config = `${FORK_CONFIG}\nbranch.main.pushremote=upstream`
    expect(await resolve(config, null)).toBe('blackpaw-studio/leoterm')
    expect(await resolve(`${config}\nremote.mine.url=https://github.com/evan/leoterm\nremote.pushdefault=mine`, null)).toBe('evan/leoterm')
  })

  test('reads git only, in the cwd, never refreshing the index', async () => {
    const { run, asked } = runner({ [CONFIG]: ok(`${FORK_CONFIG}\n`) })
    await repoFromRemotes(run, '/repo', 'main')
    expect(asked.map(one => one.init)).toEqual([{ cwd: '/repo', timeoutMs: 10_000, env: { GIT_OPTIONAL_LOCKS: '0' } }])
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
