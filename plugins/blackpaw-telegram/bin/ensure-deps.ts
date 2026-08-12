#!/usr/bin/env bun
/**
 * Idempotent, concurrency-safe `bun install` wrapper.
 *
 * This plugin directory is shared by many concurrently-launched Claude Code
 * MCP server processes. A bare `bun install` run by every launcher races on
 * node_modules symlink creation ("Failed to link X: EEXIST"), fails
 * non-zero, and (via `&&`) prevents the server from ever starting.
 *
 * This script:
 *   - fast-paths to a no-op when a sentinel proves deps already match
 *     package.json's dependency set AND the lockfile (steady-state: no
 *     install, no lock)
 *   - otherwise takes an exclusive lock (atomic O_EXCL create) so only one
 *     process installs; contenders poll-wait for the winner instead of
 *     installing in parallel
 *   - breaks locks left behind by a genuinely DEAD process (liveness is
 *     checked via signal 0 on the holder's recorded PID, not just lock
 *     age — a slow-but-alive install must never be treated as stale)
 *   - only ever removes a lock it still owns (pid+token match)
 *   - NEVER exits non-zero. Any failure here is logged to stderr and
 *     swallowed so the server always gets a chance to start.
 */

import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const POLL_INTERVAL_MS = 200
const POLL_TIMEOUT_MS = 5 * 60_000

// Fallback ceiling used ONLY when a lock holder's liveness can't be
// determined at all (e.g. permission errors reading /proc-equivalent state).
// A genuinely alive holder is never broken regardless of elapsed time; a
// genuinely dead holder is broken immediately regardless of elapsed time.
// This constant only bounds the ambiguous "unknown" case. Configurable via
// env so tests don't need to wait out a real multi-minute ceiling.
const UNKNOWN_LIVENESS_CEILING_MS = Number(
  process.env.ENSURE_DEPS_STALE_MS ?? 20 * 60_000,
)

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

type LockHandle = { fd: number; owner: string }

function makeOwnerLine(): string {
  return `${process.pid}:${randomBytes(8).toString('hex')}`
}

function parseLockOwner(content: string): { pid: number; token: string } | null {
  const trimmed = content.trim()
  const sep = trimmed.indexOf(':')
  if (sep === -1) return null
  const pid = Number(trimmed.slice(0, sep))
  const token = trimmed.slice(sep + 1)
  if (!Number.isFinite(pid) || pid <= 0 || !token) return null
  return { pid, token }
}

/** Signal-0 liveness probe. */
function isProcessAlive(pid: number): boolean | 'unknown' {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    // EPERM (exists, different user) or anything else we can't interpret:
    // don't assume dead.
    return 'unknown'
  }
}

function createLock(lockPath: string, owner: string): LockHandle | null {
  try {
    const fd = openSync(lockPath, 'wx')
    writeFileSync(lockPath, `${owner}\n`, { flag: 'w' })
    return { fd, owner }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    return null
  }
}

/**
 * Try to acquire the lock. If it's held, break it ONLY when the recorded
 * holder PID is genuinely dead (or, failing that determination, once a long
 * ceiling has passed) — never on elapsed time alone.
 */
function acquireLock(lockPath: string): LockHandle | null {
  const owner = makeOwnerLine()
  const fresh = createLock(lockPath, owner)
  if (fresh) return fresh

  let holder: { pid: number; token: string } | null = null
  let lockAgeMs = 0
  try {
    holder = parseLockOwner(readFileSync(lockPath, 'utf8'))
    lockAgeMs = Date.now() - statSync(lockPath).mtimeMs
  } catch {
    // Lock vanished between our EEXIST and reading it (winner just finished).
    return null
  }

  const alive = holder ? isProcessAlive(holder.pid) : 'unknown'
  const shouldBreak =
    alive === false || (alive === 'unknown' && lockAgeMs > UNKNOWN_LIVENESS_CEILING_MS)
  if (!shouldBreak) return null

  log(
    holder
      ? `breaking lock held by pid ${holder.pid} (liveness=${alive}, age ${Math.round(lockAgeMs / 1000)}s)`
      : `breaking unparsable lock (age ${Math.round(lockAgeMs / 1000)}s)`,
  )
  try {
    rmSync(lockPath, { force: true })
  } catch {}
  return createLock(lockPath, owner) // may lose a race to recreate; null is fine, caller retries
}

/** Only removes the lock file if it still contains OUR owner line. */
function releaseLock(lockPath: string, handle: LockHandle): void {
  try {
    closeSync(handle.fd)
  } catch {}
  try {
    const content = readFileSync(lockPath, 'utf8').trim()
    if (content === handle.owner) {
      rmSync(lockPath, { force: true })
    } else {
      log(`not removing ${lockPath}: no longer owned by us (pid ${process.pid})`)
    }
  } catch {
    // already gone — nothing to do
  }
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

  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (true) {
    if (isSentinelValid(sentinelPath, depsHash)) return

    const lock = acquireLock(lockPath)
    if (lock) {
      try {
        // Someone may have finished installing while we were acquiring the lock.
        if (isSentinelValid(sentinelPath, depsHash)) return

        if (runInstall(dir)) {
          writeSentinel(sentinelPath, depsHash, nodeModulesDir)
        } else {
          log('continuing without a confirmed dependency install; server startup will proceed anyway')
        }
      } finally {
        releaseLock(lockPath, lock)
      }
      return
    }

    if (Date.now() > deadline) {
      log(`timed out after ${POLL_TIMEOUT_MS}ms waiting for a concurrent install to finish`)
      return
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

main().catch((err) => {
  log(`unexpected error, continuing anyway: ${(err as Error)?.stack ?? err}`)
})
