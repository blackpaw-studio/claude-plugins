// Lines of spans to the pane's elements: one truncating Text per row, the
// run name a Link. Theme colour keys and dimColor only, never hex.
import type { Elements } from 'claude-code'
import type { Line, Span } from './line'

export type PaneElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Link'>

const styleOf = ({ color, dim, bold }: Span) => ({
  ...(color === undefined ? {} : { color }),
  ...(dim === true ? { dimColor: true } : {}),
  ...(bold === true ? { bold } : {}),
})

const isPlain = (part: Span): boolean => part.color === undefined && part.dim !== true && part.bold !== true

const spanNode = ({ Text, Link }: PaneElements, part: Span) => {
  const inner = part.href === undefined ? part.text : <Link href={part.href}>{part.text}</Link>
  return isPlain(part) ? inner : <Text {...styleOf(part)}>{inner}</Text>
}

export const paneTree = (elements: PaneElements, lines: readonly Line[]) => {
  const { Box, Text } = elements
  return (
    <Box flexDirection="column">
      {lines.map(line => (
        <Text wrap="truncate">{line.map(part => spanNode(elements, part))}</Text>
      ))}
    </Box>
  )
}
