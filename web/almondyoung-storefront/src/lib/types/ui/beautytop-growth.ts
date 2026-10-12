import type {
  GrowthActionDto,
  GrowthNoteDto,
  GrowthNotesResultDto,
} from "../dto/beautytop-growth"

export type GrowthAction = GrowthActionDto
export type GrowthNote = GrowthNoteDto
export type GrowthNotesResult = GrowthNotesResultDto
export const GROWTH_ACTIONS: GrowthAction[] = [
  "MENU_CLARITY",
  "SHOWCASE",
  "PRICE_CHANGE",
]
export function isGrowthAction(value: string): value is GrowthAction {
  return (
    value === "MENU_CLARITY" || value === "SHOWCASE" || value === "PRICE_CHANGE"
  )
}
