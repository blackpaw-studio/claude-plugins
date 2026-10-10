// Lines of spans to the pane's elements: one truncating Text per row; the run
// name is a plain Button that opens the run in the browser. (A Link would
// print its URL beside the name wherever the terminal lacks OSC 8, as inside
// tmux.) Theme colour keys and dimColor only, never hex.
import type { Elements } from 'claude-code'
import type { Line, Span } from './line'

export type PaneElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

/** Cells of padding each side of the pane body. */
export const PANE_PADDING = 1
/** The widest the run view lays out: past this, durations drift too far from their names to read. */
const MAX_BODY = 96

/** The width the layout fills in a pane body this wide. */
export const bodyWidth = (bodyColumns: number): number => Math.max(1, Math.min(MAX_BODY, bodyColumns - 2 * PANE_PADDING))

const styleOf = ({ color, dim, bold }: Span) => ({
  ...(color === undefined ? {} : { color }),
  ...(dim === true ? { dimColor: true } : {}),
  ...(bold === true ? { bold } : {}),
})

const isPlain = (part: Span): boolean => part.color === undefined && part.dim !== true && part.bold !== true

const spanNode = (Text: PaneElements['Text'], part: Span) => (isPlain(part) ? part.text : <Text {...styleOf(part)}>{part.text}</Text>)

const textNode = (Text: PaneElements['Text'], parts: readonly Span[]) => <Text wrap="truncate">{parts.map(part => spanNode(Text, part))}</Text>

const lineNode = ({ Box, Text, Button }: PaneElements, line: Line, onOpen: (runId: number) => void) => {
  const at = line.findIndex(part => part.opens !== undefined)
  const control = line[at]
  if (control?.opens === undefined) return textNode(Text, line)
  const runId = control.opens
  return (
    <Box key={`run:${runId}`} flexDirection="row">
      {textNode(Text, line.slice(0, at))}
      <Button plain key={`open:${runId}`} hover={{ underline: true }} onPress={() => onOpen(runId)}>
        <Text {...styleOf(control)}>{control.text}</Text>
      </Button>
      {textNode(Text, line.slice(at + 1))}
    </Box>
  )
}

export const paneTree = (elements: PaneElements, lines: readonly Line[], onOpen: (runId: number) => void) => (
  <elements.Box flexDirection="column" paddingX={PANE_PADDING}>
    {lines.map(line => lineNode(elements, line, onOpen))}
  </elements.Box>
)
