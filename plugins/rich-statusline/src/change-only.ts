// Setters that skip writes equal to the held value: `$.state` redraws every
// reader on any write, equal or not (an updater returning `held` included).

export const isSame = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * A setter over closures, so each `read`/`update` names its atom literally at
 * the call site, as the engine's scan requires. Calls run one after another,
 * so a skip is never decided against a value another call is replacing.
 */
export const changeOnly = <T,>(get: () => Promise<T>, write: (value: T) => Promise<unknown>) => {
  let queue: Promise<void> = Promise.resolve()
  return (value: T): Promise<void> => {
    const next = queue.then(async () => {
      if (!isSame(await get(), value)) await write(value)
    })
    queue = next.catch(() => undefined)
    return next
  }
}

/** The updater form: applies `change` unless it would leave the value as held; serialized too. */
export const updateOnly = <T,>(get: () => Promise<T>, write: (change: (held: T) => T) => Promise<unknown>) => {
  let queue: Promise<void> = Promise.resolve()
  return (change: (held: T) => T): Promise<void> => {
    const next = queue.then(async () => {
      const held = await get()
      if (!isSame(held, change(held))) await write(change)
    })
    queue = next.catch(() => undefined)
    return next
  }
}
