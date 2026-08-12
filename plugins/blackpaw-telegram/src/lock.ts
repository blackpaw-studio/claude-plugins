import { dlopen, FFIType, read, suffix } from 'bun:ffi'
import { closeSync, ftruncateSync, openSync, readFileSync, writeSync } from 'node:fs'

export const LOCK_EX = 2
export const LOCK_NB = 4
export const LOCK_UN = 8

// Standard errno values. EINTR (4) is universal on Linux/BSD/Darwin. EAGAIN
// and EWOULDBLOCK are the same value on both platforms we ship on, but they
// are distinct symbolic constants on some historical Unixes, so both are
// exposed and callers should treat either as "still contended, keep polling".
export const EINTR = 4
export const EAGAIN = process.platform === 'darwin' ? 35 : 11
export const EWOULDBLOCK = EAGAIN

const libPath = process.platform === 'darwin'
  ? '/usr/lib/libSystem.B.dylib'
  : `libc.${suffix}`

const { symbols } = dlopen(libPath, {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  getppid: { args: [], returns: FFIType.i32 },
  // Per-thread errno accessor: `__error` on Darwin/libSystem, `__errno_location`
  // on glibc. Both return a pointer to the thread-local errno int.
  [process.platform === 'darwin' ? '__error' : '__errno_location']: {
    args: [],
    returns: FFIType.ptr,
  },
})

/** Raw flock(2) syscall. Returns 0 on success, -1 on failure (check readErrno()). */
export function flock(fd: number, operation: number): number {
  return symbols.flock(fd, operation) as number
}

/** Reads the current thread-local errno after a failed FFI libc call. */
export function readErrno(): number {
  const errnoFn =
    process.platform === 'darwin' ? symbols.__error : (symbols as any).__errno_location
  const ptr = errnoFn()
  return read.i32(ptr as any, 0)
}

/**
 * Live parent PID via libc getppid(2). Node/Bun's `process.ppid` is cached at
 * startup, so it still reports the original parent long after that parent has
 * died and the kernel has reparented us to init (ppid=1). The orphan watchdog
 * needs the real current value, not the snapshot — otherwise an orphaned
 * poller with dead MCP stdio pipes stays alive forever and silently drops
 * every inbound Telegram update.
 */
export function liveParentPid(): number {
  return symbols.getppid() as number
}

export type LockResult =
  | { held: true; release: () => void }
  | { held: false; existingPid: string | null }

export function tryAcquirePollerLock(pidFilePath: string): LockResult {
  const fd = openSync(pidFilePath, 'a+', 0o644)
  if (flock(fd, LOCK_EX | LOCK_NB) !== 0) {
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
    try { flock(fd, LOCK_UN) } catch {}
    try { closeSync(fd) } catch {}
  }
  return { held: true, release }
}
