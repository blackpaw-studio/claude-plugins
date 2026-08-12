import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dir, 'ensure-deps.ts')

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ensure-deps-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      dependencies: { foo: '^1.0.0', bar: '^2.0.0' },
      devDependencies: { baz: '^3.0.0' },
    }),
  )
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function run(env: Record<string, string> = {}) {
  return Bun.spawn(['bun', SCRIPT, dir], {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

async function runAndWait(env: Record<string, string> = {}) {
  const proc = run(env)
  const exitCode = await proc.exited
  const stderr = await new Response(proc.stderr).text()
  return { exitCode, stderr }
}

describe('ensure-deps', () => {
  test('concurrent invocations result in at most one install, all exit 0', async () => {
    const counterFile = join(dir, 'install-count.txt')
    writeFileSync(counterFile, '')
    // Slow, trackable "install": append a line, sleep briefly so contenders
    // actually race against a lock instead of a call that returns instantly.
    const installCmd = `echo run >> ${counterFile} && sleep 0.8`

    const N = 8
    const procs = Array.from({ length: N }, () => run({ ENSURE_DEPS_INSTALL_CMD: installCmd }))
    const results = await Promise.all(
      procs.map(async (p) => ({
        exitCode: await p.exited,
        stderr: await new Response(p.stderr).text(),
      })),
    )

    for (const r of results) {
      expect(r.exitCode).toBe(0)
    }

    const installRuns = readFileSync(counterFile, 'utf8').trim().split('\n').filter(Boolean)
    expect(installRuns.length).toBe(1)

    const sentinel = readFileSync(join(dir, 'node_modules', '.deps-ok'), 'utf8').trim()
    expect(sentinel.length).toBe(64) // sha256 hex
  }, 15000)

  test('missing sentinel (corrupt/partial node_modules) triggers reinstall', async () => {
    // Simulate a partially-linked node_modules from a crashed prior run:
    // directory exists, has files, but no sentinel.
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'some-partial-pkg'), 'partial')

    const counterFile = join(dir, 'install-count.txt')
    writeFileSync(counterFile, '')
    const { exitCode } = await runAndWait({
      ENSURE_DEPS_INSTALL_CMD: `echo run >> ${counterFile}`,
    })

    expect(exitCode).toBe(0)
    const installRuns = readFileSync(counterFile, 'utf8').trim().split('\n').filter(Boolean)
    expect(installRuns.length).toBe(1)
    expect(readFileSync(join(dir, 'node_modules', '.deps-ok'), 'utf8').trim().length).toBe(64)
  })

  test('valid sentinel short-circuits: no install run', async () => {
    // First run installs and writes the sentinel.
    await runAndWait({ ENSURE_DEPS_INSTALL_CMD: 'true' })
    expect(() => readFileSync(join(dir, 'node_modules', '.deps-ok'), 'utf8')).not.toThrow()

    const counterFile = join(dir, 'install-count.txt')
    writeFileSync(counterFile, '')
    const { exitCode } = await runAndWait({
      ENSURE_DEPS_INSTALL_CMD: `echo run >> ${counterFile}`,
    })

    expect(exitCode).toBe(0)
    expect(readFileSync(counterFile, 'utf8').trim()).toBe('')
  })

  test('install failure still exits 0 (never blocks server startup)', async () => {
    const { exitCode, stderr } = await runAndWait({ ENSURE_DEPS_INSTALL_CMD: 'exit 1' })

    expect(exitCode).toBe(0)
    expect(stderr).toContain('dependency install failed')
    // No sentinel written on failure, so next launch retries.
    expect(() => readFileSync(join(dir, 'node_modules', '.deps-ok'), 'utf8')).toThrow()
  })

  test('a stale lock from a crashed process is broken and install proceeds', async () => {
    const lockPath = join(dir, '.ensure-deps.lock')
    writeFileSync(lockPath, '99999\n')
    const oldTime = new Date(Date.now() - 200_000) // > 120s stale threshold
    utimesSync(lockPath, oldTime, oldTime)

    const counterFile = join(dir, 'install-count.txt')
    writeFileSync(counterFile, '')
    const { exitCode, stderr } = await runAndWait({
      ENSURE_DEPS_INSTALL_CMD: `echo run >> ${counterFile}`,
    })

    expect(exitCode).toBe(0)
    expect(stderr).toContain('breaking stale lock')
    expect(readFileSync(counterFile, 'utf8').trim().split('\n').filter(Boolean).length).toBe(1)
    expect(readFileSync(join(dir, 'node_modules', '.deps-ok'), 'utf8').trim().length).toBe(64)
  })
})
