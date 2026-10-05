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
  showWorktree: boolean
  showCost: boolean
}

export const DETAIL_MIN_COLUMNS = 80
export const FULL_LAYOUT_MIN_COLUMNS = 60

export const viewOptions = (settings: Settings, columns: number): ViewOptions => ({
  layout: columns < FULL_LAYOUT_MIN_COLUMNS ? '1c' : settings.layout,
  columns,
  showLegend: settings.showLegend,
  showResets: columns >= DETAIL_MIN_COLUMNS,
  showPr: settings.showPr && columns >= DETAIL_MIN_COLUMNS,
  showDiff: settings.showDiff,
  showWorktree: settings.showWorktree,
  showCost: settings.showCost,
})
