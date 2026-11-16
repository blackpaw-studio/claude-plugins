// The files the shared cache needs, as a port. Hook code reaches the disk only
// through `$`; hooks/register.tsx supplies the host implementation, tests a
// fake.

export type CacheFileInfo = { name: string; mtimeMs: number }

export type CacheFs = {
  /** The file's text; null when it is missing (or unreadable). */
  read(path: string): Promise<string | null>
  /** Replaces the file whole: a reader sees the old text or the new, never a part. */
  writeAtomic(path: string, text: string): Promise<void>
  /**
   * Creates the file with `text` only if it does not exist (O_EXCL semantics):
   * `won` made it, `held` found it there, `error` could not tell.
   */
  createExclusive(path: string, text: string): Promise<'won' | 'held' | 'error'>
  remove(path: string): Promise<void>
  /** The files directly in `dir` with their modified times; empty when there is no such dir. */
  list(dir: string): Promise<CacheFileInfo[]>
}
