// The files the shared cache needs, as a port. Hook code reaches the disk only
// through `$`, and `$.fs` has no exclusive create, rename or chmod: reads and
// listings go through it, mutations through small `sh` scripts (positional
// args only, content on stdin, `umask 077` so dirs are 700 and files 600).
// hooks/register.tsx supplies the host pieces; tests a fake.
import type { Run } from './run'

export type CacheFileInfo = { name: string; mtimeMs: number }

export type CacheFs = {
  /** The file's text; null when it is missing (or unreadable). */
  read(path: string): Promise<string | null>
  /** Replaces the file whole: a reader sees the old text or the new, never a part. Rejects on failure. */
  writeAtomic(path: string, text: string): Promise<void>
  /**
   * Creates the file with `text` only if it does not exist (O_EXCL semantics),
   * the text complete from the first moment it is visible: `won` made it,
   * `held` found it there, `error` could not tell.
   */
  createExclusive(path: string, text: string): Promise<'won' | 'held' | 'error'>
  remove(path: string): Promise<void>
  /** The plain files directly in `dir` with their modified times; empty when there is no such dir. */
  list(dir: string): Promise<CacheFileInfo[]>
}

/** `mkdir -p -m 700`: parents come out 700 too under the umask. */
const ENSURE_DIR = 'umask 077; mkdir -p -m 700 "$1"'

/** Text to a tmp file beside the target, then rename(2) over it: atomic on one volume. */
const WRITE_ATOMIC = 't="$1.tmp.$$"; umask 077; if cat > "$t"; then mv -f "$t" "$1"; else rm -f "$t"; exit 1; fi'

/**
 * Text to a tmp file, then link(2) it to the target: link fails if the target
 * exists (the O_EXCL step), and the target never shows half-written. Exit 0
 * made it, 1 found it held, 2 could not tell.
 */
const CREATE_EXCLUSIVE =
  't="$1.tmp.$$"; umask 077; cat > "$t" || { rm -f "$t"; exit 2; }; if ln "$t" "$1" 2>/dev/null; then rm -f "$t"; exit 0; fi; rm -f "$t"; [ -e "$1" ] && exit 1; exit 2'

const REMOVE = 'rm -f "$1"'

const EXIT_WON = 0
const EXIT_HELD = 1

export type HostCacheFsDeps = {
  /** The file's text; rejects when it is missing. */
  readText: (path: string) => Promise<string>
  list: (dir: string) => Promise<{ name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number }[]>
  run: Run
}

const dirOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))

export const createHostCacheFs = ({ readText, list, run }: HostCacheFsDeps): CacheFs => {
  const dirs = new Map<string, Promise<void>>()

  const sh = (script: string, path: string, stdin?: string) =>
    run(['sh', '-c', script, 'sh', path], { timeoutMs: 5000, ...(stdin === undefined ? {} : { stdin }) })

  /** Once per dir per process; a failure is not remembered, so the next write tries again. */
  const ensureDir = (dir: string): Promise<void> => {
    const known = dirs.get(dir)
    if (known !== undefined) return known
    const made = sh(ENSURE_DIR, dir).then(ran => {
      if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `mkdir exited ${ran.exitCode}`)
    })
    dirs.set(dir, made)
    made.catch(() => dirs.delete(dir))
    return made
  }

  return {
    read: path => readText(path).catch(() => null),
    list: dir =>
      list(dir)
        .then(entries => entries.filter(entry => entry.kind === 'file').map(({ name, mtimeMs }) => ({ name, mtimeMs })))
        .catch(() => []),
    writeAtomic: async (path, text) => {
      await ensureDir(dirOf(path))
      const ran = await sh(WRITE_ATOMIC, path, text)
      if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `write exited ${ran.exitCode}`)
    },
    createExclusive: async (path, text) => {
      try {
        await ensureDir(dirOf(path))
        const { exitCode } = await sh(CREATE_EXCLUSIVE, path, text)
        return exitCode === EXIT_WON ? 'won' : exitCode === EXIT_HELD ? 'held' : 'error'
      } catch {
        return 'error'
      }
    },
    remove: async path => void (await sh(REMOVE, path)),
  }
}
