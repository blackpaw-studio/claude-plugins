import { describe, expect, test } from 'claude-code/testing'
import { collectPr, parsePr } from './pr'

describe('parsePr', () => {
  test('number becomes #N', () => {
    expect(parsePr({ exitCode: 0, stdout: '{"number":123,"state":"OPEN"}', stderr: '' })).toBe('#123')
  })
  test('no PR, gh unauthed or junk', () => {
    expect(parsePr({ exitCode: 1, stdout: '', stderr: 'no pull requests found' })).toBeNull()
    expect(parsePr({ exitCode: 0, stdout: 'not json', stderr: '' })).toBeNull()
    expect(parsePr({ exitCode: 0, stdout: '{"number":"x"}', stderr: '' })).toBeNull()
  })
})

describe('collectPr', () => {
  test('gh missing reads as no PR', async () => {
    const run = async (): Promise<never> => {
      throw new Error('gh: not found')
    }
    expect(await collectPr(run, '/repo')).toBeNull()
  })
  test('asks gh in the cwd', async () => {
    const seen: string[] = []
    const run = async (argv: readonly string[], init?: { cwd?: string }) => {
      seen.push(`${argv.join(' ')} @ ${init?.cwd ?? ''}`)
      return { exitCode: 0, stdout: '{"number":7,"state":"MERGED"}', stderr: '' }
    }
    expect(await collectPr(run, '/repo')).toBe('#7')
    expect(seen).toEqual(['gh pr view --json number,state @ /repo'])
  })
})
