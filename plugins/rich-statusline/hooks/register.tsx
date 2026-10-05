// rich-statusline: wiring only. Collectors, layouts and the panel live in src/.
// `$` is only ever spelled at its call sites here; src/ gets closures (Ports).
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import { changeOnly, isSame, updateOnly } from '../src/change-only'
import { withStep } from '../src/identity'
import { toUsage } from '../src/collect/usage'
import { DEFAULT_COLUMNS, statusLines, statusTree } from '../src/render'
import { createRuntime } from '../src/runtime'
import { DEFAULT_SETTINGS, parseSettings, type Settings } from '../src/settings'
import { applyPick } from '../src/settings-controls'
import { COMMAND, COMMAND_NAME, settingsBand, togglesMenu } from '../src/settings-band'

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
const settingsOpenAtom = atom({ plugin: 'rich-statusline', key: 'settingsOpen' } as const, false)

const isRetimed = (a: Settings, b: Settings): boolean =>
  a.gitRefreshSeconds !== b.gitRefreshSeconds || a.prRefreshSeconds !== b.prRefreshSeconds

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

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
          update: updateOnly(() => read($, identityAtom), change => update($, identityAtom, change)),
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
    // One writer per atom: the runtime's serialized port once attached.
    const usage = toUsage(e)
    const isWritten = await runtime.setUsage(usage)
    if (!isWritten && !isSame(await read($, usageAtom), usage)) await update($, usageAtom, () => usage)
    if (e.changed.includes('context')) runtime.contextChanged()
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      // Through the runtime's serialized identity writer once attached, so a
      // step never races the session's own identity refreshes.
      const change = (held: Parameters<typeof withStep>[0]) => withStep(held, e)
      runtime
        .updateIdentity(change)
        .then(isApplied => (isApplied ? undefined : update($, identityAtom, change)))
        .catch(error => $.ui.log(`rich-statusline: step: ${describeError(error)}`, { to: 'debug' }))
    }
    return yield* next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    runtime.cwdMaybeChanged().catch(error => $.ui.log(`rich-statusline: cwd: ${describeError(error)}`, { to: 'debug' }))
    return ran
  })

  // Toggles the settings menu in the band above the prompt; no output row.
  on('command.run', { command: 'rich-statusline' }, async ($, e) => {
    if (!togglesMenu(e.args)) return { text: `Usage: /${COMMAND_NAME} [settings]` }
    await update($, settingsOpenAtom, isOpen => !isOpen)
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The band is raised on the terminal and desktop, the two with a Select.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (e.props.hasSurvey || !(await read($, settingsOpenAtom))) return next(e)
    const settings = parseSettings(await read($, settingsAtom))
    const fail = (error: unknown) => $.ui.log(`rich-statusline: settings: ${describeError(error)}`, { to: 'debug' })
    const applyNow = async (change: (held: Settings) => unknown): Promise<void> => {
      const before = parseSettings(await read($, settingsAtom))
      const after = parseSettings(change(before))
      // One writer per atom: the runtime's serialized port once attached.
      if (!(await runtime.setSettings(after))) await update($, settingsAtom, () => after)
      await $.store.set(STORE_KEY, after)
      if (isRetimed(before, after)) runtime.retime(after)
    }
    const apply = (change: (held: Settings) => unknown): Promise<void> => {
      applying = applying.then(() => applyNow(change)).catch(fail)
      return applying
    }
    return settingsBand($.ui.resolve(e), settings, e.props.bodyColumns, {
      onPick: (key, value) => void apply(held => applyPick(held, key, value)),
      onReset: () => void apply(() => DEFAULT_SETTINGS),
      onDone: () => void update($, settingsOpenAtom, () => false).catch(fail),
    })
  })
}
