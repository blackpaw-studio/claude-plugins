import { describe, expect, test } from 'claude-code/testing'
import { isKickCommand } from './kick'

describe('isKickCommand', () => {
  test('the commands that start runs', () => {
    for (const command of [
      'git push',
      'git push -u origin feat/x',
      'git -C ../repo push --force-with-lease',
      'gh workflow run ci.yml --ref main',
      'gh pr create --fill',
      'gh run rerun 123 --failed',
    ]) {
      expect(isKickCommand(command)).toBe(true)
    }
  })
  test('anywhere in a chain, after env assignments, or on a later line', () => {
    expect(isKickCommand('git add -A && git commit -m "fix: x" && git push')).toBe(true)
    expect(isKickCommand('GIT_TRACE=0 git push origin HEAD')).toBe(true)
    expect(isKickCommand('npm test; git push 2>&1 | tail -3')).toBe(true)
    expect(isKickCommand('cd repo\ngit push')).toBe(true)
  })
  test('not lookalikes', () => {
    for (const command of [
      'git status',
      'git commit -m "push later"',
      'echo git push',
      'git stash push -m wip',
      'gh pr view',
      'gh run list',
      'gh workflow list',
      'git-push-helper',
    ]) {
      expect(isKickCommand(command)).toBe(false)
    }
  })
})
