/** Medusa store 반품 라우트 응답·요청 (snake_case). lib/api/ 에서만 import 한다. */

export interface StoreReturnableItemDto {
  item_id: string
  returnable_quantity: number
  window_ends_at: string | null
  /** 같은 품목으로 교환할 수 있는가(인쇄 줄은 false). 칸이 없던 옛 Medusa 는 false 로 읽는다. */
  exchangeable?: boolean
}

export interface StoreReturnableResponseDto {
  items: StoreReturnableItemDto[]
}

export type StoreReturnStageDto =
  | "requested"
  | "processing"
  | "refunded"
  | "exchanged"
  | "canceled"

export interface StoreReturnListItemDto {
  return_id: string
  /** 칸이 없던 옛 Medusa 는 반품으로 읽는다. */
  kind?: "return" | "exchange"
  stage: StoreReturnStageDto
  requested_at: string
  reason: string
  fee_bearer: "customer" | "seller"
  items: { item_id: string; quantity: number }[]
  can_cancel: boolean
  /** 칸이 없던 옛 Medusa 는 null 로 읽는다. */
  refund?: StoreReturnRefundDto | null
}

export interface StoreReturnRefundDto {
  /** 칸이 없던 옛 Medusa 는 settled 로 읽는다. */
  kind?: "settled" | "prepaid"
  item_total: number
  shipping_refund: number
  fees: number
  total: number
  received_at: string | null
  refunded_at: string | null
}

/** core GET /store/orders/by-channel-order/:orderId/returns/:returnId/progress */
export interface StoreReturnProgressDto {
  carrier: string | null
  carrierName: string | null
  waybillNo: string | null
  pickupStatus: "none" | "requested" | "picked_up" | "cancelled"
  pickedUpAt: string | null
  arrivedAt: string | null
  inspectedAt: string | null
  settledAt: string | null
}

export interface StoreReturnListResponseDto {
  returns: StoreReturnListItemDto[]
}

export interface StoreReturnRequestDto {
  request_id: string
  items: { item_id: string; quantity: number }[]
  reason: string
  note?: string
  /** 교환일 때만 싣는다 — 반품 본문에 칸이 없어야 옛 요청 해시가 그대로다. */
  kind?: "exchange"
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
