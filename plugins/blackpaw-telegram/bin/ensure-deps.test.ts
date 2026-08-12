import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
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

  test('a lock left by a genuinely dead process is broken and install proceeds', async () => {
    const lockPath = join(dir, '.ensure-deps.lock')
    // A PID that (almost certainly) does not exist on this machine.
    writeFileSync(lockPath, '999999:deadtoken\n')
    const oldTime = new Date(Date.now() - 200_000)
    utimesSync(lockPath, oldTime, oldTime)

    const counterFile = join(dir, 'install-count.txt')
    writeFileSync(counterFile, '')
    const { exitCode, stderr } = await runAndWait({
      ENSURE_DEPS_INSTALL_CMD: `echo run >> ${counterFile}`,
    })

    expect(exitCode).toBe(0)
    expect(stderr).toContain('breaking lock held by pid 999999')
    expect(readFileSync(counterFile, 'utf8').trim().split('\n').filter(Boolean).length).toBe(1)
    expect(readFileSync(join(dir, 'node_modules', '.deps-ok'), 'utf8').trim().length).toBe(64)
  })

  test('a lock held by a genuinely ALIVE process past the old stale window is NOT broken', async () => {
    // P1 acquires the lock and blocks synchronously inside its install for
    // longer than the (now-irrelevant) elapsed-time threshold. P2 starts
    // while P1 is still alive and must wait, not break the lock and race a
    // second install. The install duration deliberately exceeds a
    // configurable "stale window" so this reproduces the blocker scenario
    // without requiring a real 120s sleep.
    const counterFile = join(dir, 'install-count.txt')
    writeFileSync(counterFile, '')
    const readyFile = join(dir, 'p1-ready')
    const installCmd = `touch ${readyFile} && sleep 1.2 && echo run >> ${counterFile}`
    // A short "stale window" knob so this scenario (holder outlives the
    // window while still alive) reproduces in ~1s instead of 120s.
    const env = { ENSURE_DEPS_INSTALL_CMD: installCmd, ENSURE_DEPS_STALE_MS: '500' }

    const p1 = run(env)

    // Wait for P1 to actually hold the lock before starting P2.
    const deadline = Date.now() + 5000
    while (!existsSync(readyFile) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(existsSync(readyFile)).toBe(true)

    // Let the lock's age exceed the (injected, short) stale window while P1
    // is still alive and mid-install, then start P2. This is what actually
    // reproduces the blocker: staleness must be judged on liveness, not on
    // how much wall-clock time has passed.
    await new Promise((r) => setTimeout(r, 700))

    const p2 = run(env)

    const [r1, r2] = await Promise.all([
      p1.exited.then(async (exitCode) => ({ exitCode, stderr: await new Response(p1.stderr).text() })),
      p2.exited.then(async (exitCode) => ({ exitCode, stderr: await new Response(p2.stderr).text() })),
    ])

    expect(r1.exitCode).toBe(0)
    expect(r2.exitCode).toBe(0)

    const installRuns = readFileSync(counterFile, 'utf8').trim().split('\n').filter(Boolean)
    expect(installRuns.length).toBe(1)
  }, 15000)

  test('releaseLock only removes the lock if it still owns it (no ownership hijack)', async () => {
    const lockPath = join(dir, '.ensure-deps.lock')
    const readyFile = join(dir, 'p1-ready')
    const installCmd = `touch ${readyFile} && sleep 0.6`

    const p1 = run({ ENSURE_DEPS_INSTALL_CMD: installCmd })

    const deadline = Date.now() + 5000
    while (!existsSync(readyFile) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(existsSync(readyFile)).toBe(true)

    // Simulate another process having since taken over the lock (as could
    // happen if this lock were wrongly deemed stale and re-acquired).
    const impostorOwner = `${process.pid}:impostor-token`
    writeFileSync(lockPath, `${impostorOwner}\n`)

    const r1 = { exitCode: await p1.exited, stderr: await new Response(p1.stderr).text() }
    expect(r1.exitCode).toBe(0)

    // P1 must not have deleted a lock it no longer owns.
    expect(existsSync(lockPath)).toBe(true)
    expect(readFileSync(lockPath, 'utf8').trim()).toBe(impostorOwner)

    rmSync(lockPath, { force: true })
  })

  test('a change to the lockfile (resolved versions) triggers reinstall even if ranges are unchanged', async () => {
    writeFileSync(join(dir, 'bun.lock'), 'lockfile-version-1')
    const counterFile = join(dir, 'install-count.txt')
    writeFileSync(counterFile, '')

    await runAndWait({ ENSURE_DEPS_INSTALL_CMD: `echo run >> ${counterFile}` })
    expect(readFileSync(counterFile, 'utf8').trim().split('\n').filter(Boolean).length).toBe(1)

    // package.json dependency ranges are unchanged, but the lockfile
    // (resolved versions) changed underneath us.
    writeFileSync(join(dir, 'bun.lock'), 'lockfile-version-2')

    const { exitCode } = await runAndWait({
      ENSURE_DEPS_INSTALL_CMD: `echo run >> ${counterFile}`,
    })

    expect(exitCode).toBe(0)
    expect(readFileSync(counterFile, 'utf8').trim().split('\n').filter(Boolean).length).toBe(2)
  })
})
