import { describe, expect, test } from 'claude-code/testing'
import { collectPr, parsePr } from './pr'
import type { RunInit, RunResult } from './run'

const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: '' })

describe('parsePr', () => {
  test('an open PR becomes #N', () => {
    expect(parsePr(ok('{"number":123,"state":"OPEN"}'))).toBe('#123')
  })
  test('merged or closed PRs are not shown', () => {
    expect(parsePr(ok('{"number":123,"state":"MERGED"}'))).toBeNull()
    expect(parsePr(ok('{"number":123,"state":"CLOSED"}'))).toBeNull()
  })
  test('no PR, gh unauthed or junk', () => {
    expect(parsePr({ exitCode: 1, stdout: '', stderr: 'no pull requests found' })).toBeNull()
    expect(parsePr(ok('not json'))).toBeNull()
    expect(parsePr(ok('{"number":"x","state":"OPEN"}'))).toBeNull()
  })
})

describe('collectPr', () => {
  test('a run that rejects (gh missing, timeout) keeps the cache', async () => {
    const run = async (): Promise<never> => {
      throw new Error('gh: not found')
    }
    expect(await collectPr(run, '/repo')).toBeUndefined()
  })
  test('asks gh in the cwd with prompts disabled', async () => {
    const seen: string[] = []
    const run = async (argv: readonly string[], init?: RunInit) => {
      seen.push(`${argv.join(' ')} @ ${init?.cwd ?? ''} ${init?.env?.GH_PROMPT_DISABLED ?? ''}`)
      return ok('{"number":7,"state":"OPEN"}')
    }
    expect(await collectPr(run, '/repo')).toBe('#7')
    expect(seen).toEqual(['gh pr view --json number,state @ /repo 1'])
  })
})
