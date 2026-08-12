#!/usr/bin/env bun
/**
 * Idempotent, concurrency-safe `bun install` wrapper.
 *
 * This plugin directory is shared by many concurrently-launched Claude Code
 * MCP server processes. A bare `bun install` run by every launcher races on
 * node_modules symlink creation ("Failed to link X: EEXIST"), fails
 * non-zero, and (via `&&`) prevents the server from ever starting.
 *
 * DESIGN NOTE (third revision): earlier versions of this script implemented
 * mutual exclusion with a plain lock *file* — create it with O_EXCL, and
 * have waiters "break" it themselves when they judge the holder to be dead
 * (by PID liveness, then by elapsed time as a fallback). That required every
 * waiter to independently read-decide-then-mutate the lock file, which is an
 * inherent TOCTOU: the read/decide and the mutate are not atomic, so two
 * waiters can both decide to break the same lock and race each other, or a
 * live-but-slow holder can look dead by any given heuristic. Three review
 * rounds found three distinct bugs growing out of that same shape.
 *
 * This version deletes that whole bug class instead of patching it further:
 * it uses the kernel's own advisory file lock (flock(2), the same mechanism
 * already used elsewhere in this plugin — see ../src/lock.ts) as the single
 * source of truth for "is the holder still alive". flock is tied to the
 * holder's open file descriptor, so the kernel releases it automatically and
 * atomically the instant the holder process exits for ANY reason, including
 * a crash or SIGKILL — no PID bookkeeping, no staleness heuristics, no
 * "breaking" step, and therefore nothing for a TOCTOU to happen in. The lock
 * file itself is never deleted or rewritten by anyone; its content is
 * irrelevant and untouched.
 */

import { dlopen, FFIType, suffix } from 'bun:ffi'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const POLL_INTERVAL_MS = 200
const POLL_TIMEOUT_MS = 5 * 60_000

const LOCK_EX = 2
const LOCK_NB = 4
const LOCK_UN = 8

const libPath = process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : `libc.${suffix}`
const { symbols } = dlopen(libPath, {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
})

function log(msg: string): void {
  process.stderr.write(`[ensure-deps] ${msg}\n`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sortedRecord(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of Object.keys(obj).sort()) out[key] = obj[key]
  return out
}

function readLockfile(dir: string): string | null {
  for (const name of ['bun.lock', 'bun.lockb']) {
    try {
      return readFileSync(join(dir, name), 'utf8')
    } catch {
      // try next / fall through to null
    }
  }
  return null
}

function hashDependencies(pkg: Record<string, unknown>, lockfileContents: string | null): string {
  const dependencies = sortedRecord((pkg.dependencies as Record<string, string>) ?? {})
  const devDependencies = sortedRecord((pkg.devDependencies as Record<string, string>) ?? {})
  const canonical = JSON.stringify({ dependencies, devDependencies, lockfileContents })
  return createHash('sha256').update(canonical).digest('hex')
}

function isSentinelValid(sentinelPath: string, expectedHash: string): boolean {
  try {
    return readFileSync(sentinelPath, 'utf8').trim() === expectedHash
  } catch {
    return false
  }
}

function writeSentinel(sentinelPath: string, hash: string, nodeModulesDir: string): void {
  if (!existsSync(nodeModulesDir)) mkdirSync(nodeModulesDir, { recursive: true })
  writeFileSync(sentinelPath, `${hash}\n`)
}

function runInstall(dir: string): boolean {
  const cmd = process.env.ENSURE_DEPS_INSTALL_CMD ?? 'bun install --no-summary'
  log(`installing dependencies in ${dir} (${cmd})`)
  const proc = Bun.spawnSync(['bash', '-lc', cmd], {
    cwd: dir,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (proc.exitCode !== 0) {
    log(`dependency install failed with exit code ${proc.exitCode}`)
    return false
  }
  return true
}

async function main(): Promise<void> {
  const dir = process.argv[2] ?? process.cwd()
  const pkgPath = join(dir, 'package.json')
  const nodeModulesDir = join(dir, 'node_modules')
  const sentinelPath = join(nodeModulesDir, '.deps-ok')
  const lockPath = join(dir, '.ensure-deps.lock')

  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (err) {
    log(`could not read/parse ${pkgPath}: ${(err as Error).message}; skipping dependency check`)
    return
  }

  const depsHash = hashDependencies(pkg, readLockfile(dir))

  if (isSentinelValid(sentinelPath, depsHash)) return

  // Open (create-if-missing, never truncate, never delete) once. Content is
  // never read or trusted for correctness — only the kernel-managed
  // exclusive advisory lock on this fd matters.
  const fd = openSync(lockPath, 'a+', 0o644)
  try {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (symbols.flock(fd, LOCK_EX | LOCK_NB) !== 0) {
      if (isSentinelValid(sentinelPath, depsHash)) return
      if (Date.now() > deadline) {
        log(`timed out after ${POLL_TIMEOUT_MS}ms waiting for a concurrent install to finish`)
        return
      }
      await sleep(POLL_INTERVAL_MS)
    }

    try {
      // Someone may have finished installing while we were waiting for the lock.
      if (isSentinelValid(sentinelPath, depsHash)) return

      if (runInstall(dir)) {
        writeSentinel(sentinelPath, depsHash, nodeModulesDir)
      } else {
        log('continuing without a confirmed dependency install; server startup will proceed anyway')
      }
    } finally {
      try {
        symbols.flock(fd, LOCK_UN)
      } catch {}
    }
  } finally {
    try {
      closeSync(fd)
    } catch {}
  }
}

main().catch((err) => {
  log(`unexpected error, continuing anyway: ${(err as Error)?.stack ?? err}`)
})
