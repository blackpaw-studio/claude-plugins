import { dlopen, FFIType, suffix } from 'bun:ffi'
import { closeSync, ftruncateSync, openSync, readFileSync, writeSync } from 'node:fs'

const LOCK_EX = 2
const LOCK_NB = 4
const LOCK_UN = 8

const libPath = process.platform === 'darwin'
  ? '/usr/lib/libSystem.B.dylib'
  : `libc.${suffix}`

const { symbols } = dlopen(libPath, {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
})

export type LockResult =
  | { held: true; release: () => void }
  | { held: false; existingPid: string | null }

export function tryAcquirePollerLock(pidFilePath: string): LockResult {
  const fd = openSync(pidFilePath, 'a+', 0o644)
  if (symbols.flock(fd, LOCK_EX | LOCK_NB) !== 0) {
    let existingPid: string | null = null
    try {
      const contents = readFileSync(pidFilePath, 'utf8').trim()
      existingPid = contents || null
    } catch {}
    try { closeSync(fd) } catch {}
    return { held: false, existingPid }
  }
  ftruncateSync(fd, 0)
  writeSync(fd, `${process.pid}\n`, 0, 'utf8')
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    try { symbols.flock(fd, LOCK_UN) } catch {}
    try { closeSync(fd) } catch {}
  }
  return { held: true, release }
}
