// What the layouts show at a width under the person's settings. Pure.
import type { RichStatuslineLayout } from '../types'
import type { Settings } from './settings'

export type ViewOptions = {
  layout: RichStatuslineLayout
  columns: number
  showLegend: boolean
  showResets: boolean
  showPr: boolean
  showDiff: boolean
  showCost: boolean
}

export const LEGEND_MIN_COLUMNS = 100
export const DETAIL_MIN_COLUMNS = 80
export const FULL_LAYOUT_MIN_COLUMNS = 60

export const viewOptions = (settings: Settings, columns: number): ViewOptions => ({
  layout: columns < FULL_LAYOUT_MIN_COLUMNS ? '1c' : settings.layout,
  columns,
  showLegend: settings.showLegend && columns >= LEGEND_MIN_COLUMNS,
  showResets: columns >= DETAIL_MIN_COLUMNS,
  showPr: settings.showPr && columns >= DETAIL_MIN_COLUMNS,
  showDiff: settings.showDiff,
  showCost: settings.showCost,
})
