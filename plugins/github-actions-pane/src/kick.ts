// Which shell commands start workflow runs, so the poller speeds up right
// after one instead of waiting out the idle interval. Pure.

const SEPARATORS = /&&|\|\||[;|&\n]/
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
/** git's global options that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])
const GH_KICKS = new Set(['workflow run', 'pr create', 'run rerun'])

const wordsOf = (segment: string): string[] => {
  const words = segment.trim().replace(/^\(+/, '').split(/\s+/).filter(word => word !== '')
  const start = words.findIndex(word => !ENV_ASSIGNMENT.test(word))
  return start === -1 ? [] : words.slice(start)
}

/** git's subcommand: the first word after git that is not a global option or its value. */
const gitSubcommand = (args: readonly string[]): string | undefined => {
  const index = args.findIndex((word, i) => !word.startsWith('-') && !GIT_VALUE_OPTIONS.has(args[i - 1] ?? ''))
  return index === -1 ? undefined : args[index]
}

const isKickSegment = (segment: string): boolean => {
  const [command, ...args] = wordsOf(segment)
  if (command === 'git') return gitSubcommand(args) === 'push'
  if (command === 'gh') return GH_KICKS.has(args.slice(0, 2).join(' '))
  return false
}

/** True when any command in the line is `git push`, `gh workflow run`, `gh pr create` or `gh run rerun`. */
export const isKickCommand = (command: string): boolean => command.split(SEPARATORS).some(isKickSegment)
