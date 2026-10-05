// rich-statusline: wiring only. Collectors, layouts and the panel live in src/.
// `$` is only ever spelled at its call sites here; src/ gets closures (Ports).
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import { withStep } from '../src/identity'
import { toUsage } from '../src/collect/usage'
import { DEFAULT_COLUMNS, statusLines, statusTree } from '../src/render'
import { createRuntime } from '../src/runtime'
import { DEFAULT_SETTINGS, parseSettings, type Settings } from '../src/settings'
import { applyPick } from '../src/settings-controls'
import { COMMAND, COMMAND_NAME, opensPanel, PANE, PANE_ID, settingsPane } from '../src/settings-pane'

const STORE_KEY = 'settings'

// The $.state values (contract: types/index.d.ts). Written here, beside their
// readers, so the engine's scan can read every reference.
const settingsAtom = atom({ plugin: 'rich-statusline', key: 'settings' } as const, null)
const gitAtom = atom({ plugin: 'rich-statusline', key: 'git' } as const, null)
const prAtom = atom({ plugin: 'rich-statusline', key: 'pr' } as const, null)
const identityAtom = atom({ plugin: 'rich-statusline', key: 'identity' } as const, null)
const usageAtom = atom({ plugin: 'rich-statusline', key: 'usage' } as const, null)
const breakdownAtom = atom({ plugin: 'rich-statusline', key: 'breakdown' } as const, null)
const nowAtom = atom({ plugin: 'rich-statusline', key: 'now' } as const, 0)

const isRetimed = (a: Settings, b: Settings): boolean =>
  a.gitRefreshSeconds !== b.gitRefreshSeconds || a.prRefreshSeconds !== b.prRefreshSeconds

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const isSame = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * A setter that skips a write equal to what is held: `$.state` redraws every
 * reader on any write, equal or not. Takes closures, so each `read`/`update`
 * names its atom literally at the call site, as the engine's scan requires.
 */
const changeOnly =
  <T,>(get: () => Promise<T>, write: (value: T) => Promise<unknown>) =>
  async (value: T): Promise<void> => {
    if (!isSame(await get(), value)) await write(value)
  }

export const register: Register = on => {
  const runtime = createRuntime()
  // Settings changes apply one after another, so the store sees them in order.
  let applying: Promise<void> = Promise.resolve()

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    if (!runtime.isAttached()) {
      // Collectors start from a timer: a render hook itself never writes state.
      runtime.attach({
        run: (argv, init) => $.process.run(argv, init),
        model: () => $.session.model(),
        cwd: () => $.session.cwd(),
        home: () => $.env.get('HOME'),
        configuredEffort: async () => (await $.settings.read()).effortLevel,
        usage: () => $.session.usage({ breakdown: 'summary' }),
        now: () => $.clock.now(),
        every: (ms, fn) => $.clock.every(ms, fn),
        after: (ms, fn) => $.clock.after(ms, fn),
        storedSettings: () => $.store.get(STORE_KEY),
        registerCommand: () => $.command.register(COMMAND),
        log: text => $.ui.log(text, { to: 'debug' }),
        git: {
          get: () => read($, gitAtom),
          set: changeOnly(() => read($, gitAtom), value => update($, gitAtom, () => value)),
        },
        pr: { set: changeOnly(() => read($, prAtom), value => update($, prAtom, () => value)) },
        identity: {
          get: () => read($, identityAtom),
          update: async change => {
            const held = await read($, identityAtom)
            if (!isSame(held, change(held))) await update($, identityAtom, change)
          },
        },
        usageState: { set: changeOnly(() => read($, usageAtom), value => update($, usageAtom, () => value)) },
        breakdown: { set: changeOnly(() => read($, breakdownAtom), value => update($, breakdownAtom, () => value)) },
        clockState: { set: changeOnly(() => read($, nowAtom), value => update($, nowAtom, () => value)) },
        settings: { set: changeOnly(() => read($, settingsAtom), value => update($, settingsAtom, () => value)) },
      })
    }
    const [engine, settings, git, pr, identity, usage, breakdown, now] = await Promise.all([
      next(e),
      read($, settingsAtom),
      read($, gitAtom),
      read($, prAtom),
      read($, identityAtom),
      read($, usageAtom),
      read($, breakdownAtom),
      read($, nowAtom),
    ])
    // Until the stored settings load, the engine's line alone: no flash of 1a.
    if (settings === null) return engine
    const inputs = { settings: parseSettings(settings), git, pr, identity, usage, breakdown, now }
    return statusTree($.ui.resolve(e), statusLines(inputs, e.viewport?.columns ?? DEFAULT_COLUMNS), engine)
  })

  // A new or resumed session: the cwd, branch and effort may all have moved.
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    runtime.sessionStarted().catch(error => $.ui.log(`rich-statusline: session: ${describeError(error)}`, { to: 'debug' }))
    return started
  })

  on('session.measure', async ($, e, next) => {
    const usage = toUsage(e)
    if (!isSame(await read($, usageAtom), usage)) await update($, usageAtom, () => usage)
    if (e.changed.includes('context')) runtime.contextChanged()
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      update($, identityAtom, held => withStep(held, e)).catch(error => $.ui.log(`rich-statusline: step: ${describeError(error)}`, { to: 'debug' }))
    }
    return yield* next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    runtime.cwdMaybeChanged().catch(error => $.ui.log(`rich-statusline: cwd: ${describeError(error)}`, { to: 'debug' }))
    return ran
  })

  on('command.run', { command: 'rich-statusline' }, async ($, e) => {
    if (!opensPanel(e.args)) return { text: `Usage: /${COMMAND_NAME} [settings]` }
    const opened = await $.ui.open(PANE)
    return opened.isPlaced ? {} : { text: `rich-statusline: the settings panel is waiting for room (${opened.reason}).` }
  })

  on('ui.render', { component: 'Pane', requestId: 'rich-statusline-settings' }, async ($, e) => {
    const settings = parseSettings(await read($, settingsAtom))
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Open /{COMMAND_NAME} in a terminal to change these settings.</Text>
    }
    const fail = (error: unknown) => $.ui.log(`rich-statusline: settings: ${describeError(error)}`, { to: 'debug' })
    const applyNow = async (change: (held: Settings) => unknown): Promise<void> => {
      const before = parseSettings(await read($, settingsAtom))
      const saved = await update($, settingsAtom, held => parseSettings(change(parseSettings(held))))
      const after = parseSettings(saved)
      await $.store.set(STORE_KEY, after)
      if (isRetimed(before, after)) runtime.retime(after)
    }
    const apply = (change: (held: Settings) => unknown): Promise<void> => {
      applying = applying.then(() => applyNow(change)).catch(fail)
      return applying
    }
    return settingsPane($.ui.resolve(e), settings, {
      onPick: (key, value) => void apply(held => applyPick(held, key, value)),
      onReset: () => void apply(() => DEFAULT_SETTINGS),
      onClose: () => void $.ui.close({ id: PANE_ID }).catch(fail),
    })
  })
}
