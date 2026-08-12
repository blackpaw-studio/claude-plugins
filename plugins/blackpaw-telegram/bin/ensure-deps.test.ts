import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
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

async function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20))
  }
  expect(existsSync(path)).toBe(true)
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

  test('a leftover lock file with arbitrary stale content does not block a fresh run', async () => {
    // Earlier revisions parsed lock-file content (pid/token) to decide
    // whether to "break" it, which is exactly the mechanism that produced
    // the TOCTOU and pid-reuse bugs found in review. The current design
    // never reads or trusts lock-file content for correctness — only the
    // kernel-managed flock on the fd matters — so a leftover file with
    // garbage content (e.g. from an old revision, or truncated by a crash)
    // must never block or delay a fresh run.
    const lockPath = join(dir, '.ensure-deps.lock')
    writeFileSync(lockPath, 'garbage-not-a-pid-not-a-token\n')

    const counterFile = join(dir, 'install-count.txt')
    writeFileSync(counterFile, '')
    const { exitCode } = await runAndWait({
      ENSURE_DEPS_INSTALL_CMD: `echo run >> ${counterFile}`,
    })

    expect(exitCode).toBe(0)
    expect(readFileSync(counterFile, 'utf8').trim().split('\n').filter(Boolean).length).toBe(1)
    expect(readFileSync(join(dir, 'node_modules', '.deps-ok'), 'utf8').trim().length).toBe(64)
  })

  test('a crashed holder (SIGKILL) releases the lock immediately; a waiting contender takes over', async () => {
    // This is the regression test for the class of bug found across three
    // review rounds on the old file-based lock (TOCTOU on breaking, pid
    // reuse looking "alive" forever). With flock(2) there is no heuristic
    // and no "breaking" step: the kernel releases the lock the instant the
    // holder's file descriptors close, for ANY reason including a crash —
    // so a waiter picks it up deterministically, not on a timing guess.
    const readyFile = join(dir, 'p1-ready')
    const holderInstallCmd = `touch ${readyFile} && sleep 30`
    const p1 = run({ ENSURE_DEPS_INSTALL_CMD: holderInstallCmd })

    await waitForFile(readyFile)

    const counterFile = join(dir, 'install-count.txt')
    writeFileSync(counterFile, '')
    const p2 = run({ ENSURE_DEPS_INSTALL_CMD: `echo run >> ${counterFile}` })

    // Give P2 a moment to start polling for the (currently held) lock, then
    // simulate a hard crash of the holder.
    await new Promise((r) => setTimeout(r, 300))
    p1.kill('SIGKILL')

    const start = Date.now()
    const p2ExitCode = await p2.exited
    const elapsedMs = Date.now() - start

    expect(p2ExitCode).toBe(0)
    // Must take over promptly (kernel-driven), not wait out the 5-minute poll cap.
    expect(elapsedMs).toBeLessThan(10_000)
    expect(readFileSync(counterFile, 'utf8').trim().split('\n').filter(Boolean).length).toBe(1)
    expect(readFileSync(join(dir, 'node_modules', '.deps-ok'), 'utf8').trim().length).toBe(64)

    // p1's orphaned `sleep 30` child may still be running; nothing else in
    // this process depends on it, so we don't wait on it.
  }, 15000)

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
