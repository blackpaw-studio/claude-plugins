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
 *     package.json's dependency set (steady-state: no install, no lock)
 *   - otherwise takes an exclusive lock (atomic O_EXCL create) so only one
 *     process installs; contenders poll-wait for the winner instead of
 *     installing in parallel
 *   - breaks stale locks left behind by a crashed/killed prior run
 *   - NEVER exits non-zero. Any failure here is logged to stderr and
 *     swallowed so the server always gets a chance to start.
 */

import { createHash } from 'node:crypto'
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

const STALE_LOCK_MS = 120_000
const POLL_INTERVAL_MS = 200
const POLL_TIMEOUT_MS = 5 * 60_000

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

function hashDependencies(pkg: Record<string, unknown>): string {
  const dependencies = sortedRecord((pkg.dependencies as Record<string, string>) ?? {})
  const devDependencies = sortedRecord((pkg.devDependencies as Record<string, string>) ?? {})
  const canonical = JSON.stringify({ dependencies, devDependencies })
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

/** Atomically acquire an exclusive lock via O_EXCL. Breaks stale locks. */
function acquireLock(lockPath: string): number | null {
  try {
    const fd = openSync(lockPath, 'wx')
    writeFileSync(lockPath, `${process.pid}\n`, { flag: 'w' })
    return fd
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }

  // Lock already held by someone else (or a crashed process). Check staleness.
  try {
    const st = statSync(lockPath)
    const ageMs = Date.now() - st.mtimeMs
    if (ageMs > STALE_LOCK_MS) {
      log(`breaking stale lock at ${lockPath} (age ${Math.round(ageMs / 1000)}s)`)
      rmSync(lockPath, { force: true })
      try {
        const fd = openSync(lockPath, 'wx')
        writeFileSync(lockPath, `${process.pid}\n`, { flag: 'w' })
        return fd
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }
    }
  } catch {
    // lock file vanished between checks (winner finished) — fall through, not acquired
  }
  return null
}

function releaseLock(lockPath: string, fd: number): void {
  try {
    closeSync(fd)
  } catch {}
  try {
    rmSync(lockPath, { force: true })
  } catch {}
}

/** Wait for the lock holder to finish, without ever installing ourselves. */
async function waitForCompletion(
  sentinelPath: string,
  depsHash: string,
  lockPath: string,
): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (isSentinelValid(sentinelPath, depsHash)) return
    if (!existsSync(lockPath)) {
      // Winner released the lock. Either it succeeded (sentinel would match
      // above) or it failed. Either way, don't pile on another install —
      // just let the server try to start.
      return
    }
    await sleep(POLL_INTERVAL_MS)
  }
  log(`timed out after ${POLL_TIMEOUT_MS}ms waiting for concurrent install to finish`)
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

  const depsHash = hashDependencies(pkg)

  if (isSentinelValid(sentinelPath, depsHash)) return

  const fd = acquireLock(lockPath)
  if (fd === null) {
    await waitForCompletion(sentinelPath, depsHash, lockPath)
    return
  }

  try {
    // Someone may have finished installing while we were acquiring the lock.
    if (isSentinelValid(sentinelPath, depsHash)) return

    if (runInstall(dir)) {
      writeSentinel(sentinelPath, depsHash, nodeModulesDir)
    } else {
      log('continuing without a confirmed dependency install; server startup will proceed anyway')
    }
  } finally {
    releaseLock(lockPath, fd)
  }
}

main().catch((err) => {
  log(`unexpected error, continuing anyway: ${(err as Error)?.stack ?? err}`)
})
