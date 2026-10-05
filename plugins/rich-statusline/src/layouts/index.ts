// Picks the layout the view options name; every layout ends in the shared rule.
import type { Line } from '../line'
import type { Snapshot } from '../snapshot'
import type { ViewOptions } from '../view-options'
import { layout1a } from './1a'
import { layout1b } from './1b'
import { layout1c } from './1c'
import { ruleRow } from './parts'

const LAYOUTS = { '1a': layout1a, '1b': layout1b, '1c': layout1c } as const

export const renderLayout = (snapshot: Snapshot, options: ViewOptions): Line[] => [
  ...LAYOUTS[options.layout](snapshot, options),
  ruleRow(options.columns),
]
