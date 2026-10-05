// Layout lines to terminal elements, and the status rows over the engine's line.
import type { Elements, RenderElement } from 'claude-code'
import { renderLayout } from './layouts/index'
import type { Line, Span } from './line'
import { buildSnapshot, type SnapshotInputs } from './snapshot'
import { viewOptions } from './view-options'

export const DEFAULT_COLUMNS = 120

export type StatusElements = Pick<Elements['terminal'], 'Box' | 'Text'>

const spanNode = (Text: StatusElements['Text'], { text, color, bold }: Span) =>
  color === undefined && bold !== true ? (
    text
  ) : (
    <Text {...(color === undefined ? {} : { color })} {...(bold === true ? { bold } : {})}>
      {text}
    </Text>
  )

export const lineNode = (Text: StatusElements['Text'], line: Line) => (
  <Text wrap="truncate">{line.map(s => spanNode(Text, s))}</Text>
)

/** The rows the inputs draw at `columns`. Pure. */
export const statusLines = (inputs: SnapshotInputs, columns: number): Line[] =>
  renderLayout(buildSnapshot(inputs), viewOptions(inputs.settings, columns))

/** Our rows, then the engine's own line unchanged as the last child. */
export const statusTree = ({ Box, Text }: StatusElements, lines: readonly Line[], engine: RenderElement) => (
  <Box flexDirection="column">
    {lines.map(line => lineNode(Text, line))}
    {engine}
  </Box>
)
