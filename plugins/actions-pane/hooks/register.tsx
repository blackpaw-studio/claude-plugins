// actions-pane: wiring only. The poller, snapshot, lifecycle and layout live
// in src/. `$` is only ever spelled at its call sites here; src/ gets
// closures (Ports).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { isKickCommand } from '../src/kick'
import { layoutPane } from '../src/layout'
import { EMPTY_DATA } from '../src/model'
import { PANE_PADDING, paneTree } from '../src/pane'
import { createRuntime, type Ports, type Runtime, TICK_MS } from '../src/runtime'
import { isScope, parseSettings } from '../src/settings'
import { buildSnapshot } from '../src/snapshot'

const PANE = 'actions'
const TITLE = 'Actions'

// The $.state values (contract: types/index.d.ts). Written here, beside their
// readers, so the engine's scan can read every reference.
const dataAtom = atom({ plugin: 'actions-pane', key: 'data' } as const, null)
const nowAtom = atom({ plugin: 'actions-pane', key: 'now' } as const, 0)
const scopeAtom = atom({ plugin: 'actions-pane', key: 'scope' } as const, null)
const manualAtom = atom({ plugin: 'actions-pane', key: 'isManual' } as const, false)

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The runtime's view of the engine: every `$` call it makes, as closures. */
function portsOf($: EngineInterface): Ports {
  return {
    run: (argv, init) => $.process.run(argv, init),
    cwd: () => $.session.cwd(),
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    every: (ms, fn) => $.clock.every(ms, fn),
    data: { get: () => read($, dataAtom), set: value => update($, dataAtom, () => value).then(() => undefined) },
    clock: { set: value => update($, nowAtom, () => value).then(() => undefined) },
    manual: { get: () => read($, manualAtom), set: value => update($, manualAtom, () => value).then(() => undefined) },
    scope: { get: () => read($, scopeAtom), set: value => update($, scopeAtom, () => value).then(() => undefined) },
    open: () => $.ui.open({ id: PANE, title: TITLE }),
    close: () => $.ui.close({ id: PANE }),
    pane: async () => {
      const pane = (await $.ui.panes()).find(one => one.id === PANE)
      return { isOpen: pane !== undefined, isPlaced: pane?.isPlaced ?? false }
    },
    status: text => $.ui.status(text),
    log: text => $.ui.log(text, { to: 'debug' }),
  }
}

export const register: Register = (on, options) => {
  const settings = parseSettings(options)
  let runtime: Runtime | null = null

  /** The runtime over these ports, started once per module load. */
  const attach = (ports: Ports): Runtime => {
    if (runtime !== null) return runtime
    const started = createRuntime(ports, settings)
    runtime = started
    started.start().catch(error => ports.log(`actions-pane: start: ${describeError(error)}`))
    return started
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'actions',
      description: 'Toggle the GitHub Actions pane; with commit, branch or repo, set what it watches this session',
      argumentHint: '[commit|branch|repo]',
      immediate: true,
    })
    attach(portsOf($))
    return started
  })

  // A /clear empties the session's state and no session.start follows.
  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear') runtime?.republish().catch(error => $.ui.log(`actions-pane: clear: ${describeError(error)}`, { to: 'debug' }))
    return ended
  })

  // After a push (or a run started from gh), poll at once; any other Bash call may have moved the cwd.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const watcher = attach(portsOf($))
    const work = isKickCommand(e.command) ? watcher.kick() : watcher.cwdMaybeChanged()
    work.catch(error => $.ui.log(`actions-pane: bash: ${describeError(error)}`, { to: 'debug' }))
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'actions' }, async ($, e) => {
    const watcher = attach(portsOf($))
    const arg = e.args.trim()
    if (arg === '') {
      // Opened here, in the person's command, so it seats at any width.
      const reply = await watcher.toggle(() => $.ui.open({ id: PANE, title: TITLE }))
      return reply.isQuiet ? {} : { text: reply.text }
    }
    if (!isScope(arg)) return { text: 'Usage: /actions [commit|branch|repo]' }
    return { text: (await watcher.setScope(arg)).text }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    if (e.origin.kind === 'person') runtime?.closedByPerson().catch(error => $.ui.log(`actions-pane: close: ${describeError(error)}`, { to: 'debug' }))
    return closed
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const [data, now, scope, isManual] = await Promise.all([read($, dataAtom), read($, nowAtom), read($, scopeAtom), read($, manualAtom)])
    const snapshot = buildSnapshot({ data: data ?? EMPTY_DATA, now, settings, scope: scope ?? settings.scope, isManual })
    const width = e.props.bodyColumns - 2 * PANE_PADDING
    const lines = layoutPane(snapshot, { width, rows: e.props.scroll.bodyRows, frame: Math.floor(now / TICK_MS) })
    const open = (runId: number) =>
      void $.process
        .run(['gh', 'run', 'view', String(runId), '--web'], { env: { GH_PROMPT_DISABLED: '1' }, timeoutMs: 10_000 })
        .catch(error => $.ui.log(`actions-pane: open: ${describeError(error)}`, { to: 'debug' }))
    return paneTree($.ui.resolve(e), lines, open)
  })
}
