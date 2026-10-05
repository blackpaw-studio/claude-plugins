// Layout lines to terminal elements, and the status rows over the engine's line.
import type { Elements, RenderElement } from 'claude-code'
import { renderLayout } from './layouts/index'
import { BLANK_LINE, type Line, type Span } from './line'
import { buildSnapshot, type SnapshotInputs } from './snapshot'
import { viewOptions } from './view-options'

export const DEFAULT_COLUMNS = 120
/**
 * Columns the engine pads the PromptHint tree by: 2 on the left (its own hint
 * line sits at the same inset) and 2 on the right, measured in a live session.
 * PromptHint carries no width prop, so a row sized to `viewport.columns` runs
 * this far past the edge and is cut with `…`.
 */
export const PROMPT_HINT_INSET = 4

/** The width our rows lay out in at a viewport this wide: the inset taken off, never below 0. Pure. */
export const layoutColumns = (viewportColumns: number): number => Math.max(0, viewportColumns - PROMPT_HINT_INSET)

export type StatusElements = Pick<Elements['terminal'], 'Box' | 'Text'>

const spanNode = (Text: StatusElements['Text'], { text, color, dim, bold }: Span) =>
  color === undefined && dim !== true && bold !== true ? (
    text
  ) : (
    <Text
      {...(color === undefined ? {} : { color })}
      {...(dim === true ? { dimColor: true } : {})}
      {...(bold === true ? { bold } : {})}
    >
      {text}
    </Text>
  )

export const lineNode = (Text: StatusElements['Text'], line: Line) => (
  <Text wrap="truncate">{line.map(s => spanNode(Text, s))}</Text>
)

/** The rows the inputs draw at `columns`. Pure. */
export const statusLines = (inputs: SnapshotInputs, columns: number): Line[] =>
  renderLayout(buildSnapshot(inputs), viewOptions(inputs.settings, columns))

/** One blank row above our rows, then the engine's own line unchanged, right after them. */
export const statusTree = ({ Box, Text }: StatusElements, lines: readonly Line[], engine: RenderElement) => (
  <Box flexDirection="column">
    {[BLANK_LINE, ...lines].map(line => lineNode(Text, line))}
    {engine}
  </Box>
)
