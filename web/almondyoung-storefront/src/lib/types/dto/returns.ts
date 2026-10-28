/** Medusa store 반품 라우트 응답·요청 (snake_case). lib/api/ 에서만 import 한다. */

export interface StoreReturnableItemDto {
  item_id: string
  returnable_quantity: number
  window_ends_at: string | null
}

export interface StoreReturnableResponseDto {
  items: StoreReturnableItemDto[]
}

export type StoreReturnStageDto =
  | "requested"
  | "processing"
  | "refunded"
  | "canceled"

export interface StoreReturnListItemDto {
  return_id: string
  stage: StoreReturnStageDto
  requested_at: string
  reason: string
  fee_bearer: "customer" | "seller"
  items: { item_id: string; quantity: number }[]
  can_cancel: boolean
}

export interface StoreReturnListResponseDto {
  returns: StoreReturnListItemDto[]
}

export interface StoreReturnRequestDto {
  request_id: string
  items: { item_id: string; quantity: number }[]
  reason: string
  note?: string
}

export interface StoreReturnRequestResponseDto {
  return_id: string
  request_id: string
  status: string
  items: { item_id: string; quantity: number }[]
  fee_bearer: string
  window_overridden: boolean
}

export interface StoreReturnErrorDto {
  type?: string
  code?: string
  reason?: string
  message?: string
}
