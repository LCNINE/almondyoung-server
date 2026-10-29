export interface ReturnableLine {
  itemId: string
  returnableQuantity: number
  windowEndsAt: string | null
  exchangeable: boolean
}

export type CustomerReturnStage =
  | "requested"
  | "processing"
  | "refunded"
  | "exchanged"
  | "canceled"

export interface CustomerReturn {
  returnId: string
  kind: "return" | "exchange"
  stage: CustomerReturnStage
  requestedAt: string
  reason: string
  feeBearer: "customer" | "seller"
  items: { itemId: string; quantity: number }[]
  canCancel: boolean
}

export interface ReturnRequestInput {
  requestId: string
  items: { itemId: string; quantity: number }[]
  reason: string
  note?: string
  /** 교환 신청이면 "exchange". 반품은 비워 둔다(본문에 kind 칸을 싣지 않는다). */
  kind?: "exchange"
}
