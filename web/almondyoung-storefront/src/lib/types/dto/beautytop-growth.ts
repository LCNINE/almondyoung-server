export type GrowthActionDto = "MENU_CLARITY" | "SHOWCASE" | "PRICE_CHANGE"
export type GrowthNoteTargetDto = {
  shopKind: "SHOP" | "PERSON"
  shopId: number
}
export type GrowthNoteDto = {
  id: string
  action: string
  memo: string
  recordedOn: string
  createdAt: string
}
export type RecordGrowthNoteDto = GrowthNoteTargetDto & {
  action: GrowthActionDto
  memo?: string
}
export type GrowthNotesResultDto =
  | { ok: true; data: GrowthNoteDto[] }
  | { ok: false; code: "SHOP_CHANGED" | "FAILED" }
