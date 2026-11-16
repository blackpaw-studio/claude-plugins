// Glue over `sh`, tested at its boundary: the argv and stdin it hands the
// process runner, and how exit codes read back. Real behavior (O_EXCL under
// contention, modes) is checked against real sh by hand; see the plan.
import { describe, expect, test } from 'claude-code/testing'
import { createHostCacheFs } from './cache-fs'
import type { RunInit, RunResult } from './run'

const DIR = '/cache/github-actions-pane'
const done = (exitCode = 0): RunResult => ({ exitCode, stdout: '', stderr: exitCode === 0 ? '' : 'boom' })

const setup = (exitFor: (args: readonly string[]) => number = () => 0) => {
  const calls: { args: string[]; init: RunInit | undefined }[] = []
  const fs = createHostCacheFs({
    readText: async path => (path === `${DIR}/a.json` ? 'text' : Promise.reject(new Error('ENOENT'))),
    list: async dir =>
      dir === DIR
        ? [
            { name: 'a.json', kind: 'file', mtimeMs: 5 },
            { name: 'sub', kind: 'dir', mtimeMs: 0 },
            { name: 'link', kind: 'other', mtimeMs: 0 },
          ]
        : Promise.reject(new Error('ENOENT')),
    run: async (argv, init) => {
      const args = argv.slice(4)
      calls.push({ args: [...args], init })
      return argv[0] === 'sh' && argv[1] === '-c' ? done(exitFor(args)) : done(1)
    },
  })
  return { fs, calls }
}

describe('createHostCacheFs', () => {
  test('read is the text, or null when the file is missing', async () => {
    const { fs } = setup()
    expect(await fs.read(`${DIR}/a.json`)).toBe('text')
    expect(await fs.read(`${DIR}/none.json`)).toBe(null)
  })

  test('list is the plain files with their mtimes, empty for a missing dir', async () => {
    const { fs } = setup()
    expect(await fs.list(DIR)).toEqual([{ name: 'a.json', mtimeMs: 5 }])
    expect(await fs.list('/elsewhere')).toEqual([])
  })

  test('the dir is made once, owner-only, before the first write', async () => {
    const { fs, calls } = setup()
    await fs.writeAtomic(`${DIR}/a.json`, 'one')
    await fs.writeAtomic(`${DIR}/b.json`, 'two')
    await fs.createExclusive(`${DIR}/a.lock`, 'lock')
    const made = calls.filter(call => call.args.length === 1 && call.args[0] === DIR)
    expect(made.length).toBe(1)
    expect(calls[0]?.args).toEqual([DIR])
  })

  test('a write sends the text on stdin to the one path', async () => {
    const { fs, calls } = setup()
    await fs.writeAtomic(`${DIR}/a.json`, '{"x":1}')
    const write = calls.find(call => call.args[0] === `${DIR}/a.json`)
    expect(write?.init?.stdin).toBe('{"x":1}')
  })

  test('a failed write rejects, so the caller can log it', async () => {
    const { fs } = setup(args => (args[0] === `${DIR}/a.json` ? 1 : 0))
    await expect(fs.writeAtomic(`${DIR}/a.json`, 'x')).rejects.toThrow('boom')
  })

  test('exclusive create reads back won, held or error from the exit code', async () => {
    const codes: Record<string, number> = { [`${DIR}/won.lock`]: 0, [`${DIR}/held.lock`]: 1, [`${DIR}/err.lock`]: 2 }
    const { fs } = setup(args => codes[args[0] ?? ''] ?? 0)
    expect(await fs.createExclusive(`${DIR}/won.lock`, 'x')).toBe('won')
    expect(await fs.createExclusive(`${DIR}/held.lock`, 'x')).toBe('held')
    expect(await fs.createExclusive(`${DIR}/err.lock`, 'x')).toBe('error')
  })

  test('a runner that throws is an error, not a crash', async () => {
    const fs = createHostCacheFs({ readText: async () => '', list: async () => [], run: async () => Promise.reject(new Error('spawn failed')) })
    expect(await fs.createExclusive(`${DIR}/a.lock`, 'x')).toBe('error')
  })

  test('remove names the one path', async () => {
    const { fs, calls } = setup()
    await fs.remove(`${DIR}/a.lock`)
    expect(calls.at(-1)?.args).toEqual([`${DIR}/a.lock`])
  })
})
