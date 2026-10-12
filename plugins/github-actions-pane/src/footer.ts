// Whether the footer tail is on screen. The engine draws PromptHint's `tail` on
// the terminal only, pads the line two columns each side, and leaves the tail
// out when under four columns of it would show. A render hook may not write
// $.state, so the hook reports here and the runtime reads it when deciding
// whether the status line still has to say what runs.

/** Columns the engine pads around the hint line (two each side). */
const PADDING = 4
/** The least of the tail the engine will draw. */
const MIN_TAIL_COLUMNS = 4

type TailRoom = {
  /** The viewport's width; unknown means no promise. */
  columns: number | undefined
  hint: string
  /** A tail another hook set: it sits before ours. */
  tail?: string
  separator: string
}

const columnsOf = (text: string): number => [...text].length

/** Conservatively: does at least a few columns of our text fit after the hint? */
export const fitsTail = ({ columns, hint, tail = '', separator }: TailRoom): boolean =>
  columns !== undefined && columns - PADDING - columnsOf(hint) - columnsOf(tail) - columnsOf(separator) >= MIN_TAIL_COLUMNS

export type FooterGate = {
  /** Called by every PromptHint render: whether the tail was added and fits. */
  report: (isShowing: boolean) => void
  isShowing: () => boolean
}

/** Nothing reported yet means not showing. */
export const createFooterGate = (): FooterGate => {
  let isShowing = false
  return { report: next => void (isShowing = next), isShowing: () => isShowing }
}
