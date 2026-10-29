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
  /** 교환이거나 아직 정산 전이면 null */
  refund: CustomerReturnRefund | null
}

export interface CustomerReturnRefund {
  itemTotal: number
  shippingRefund: number
  /** 반품 택배비 등 환불액에서 뺀 합 */
  fees: number
  total: number
  receivedAt: string | null
  refundedAt: string | null
}

export interface CustomerReturnProgress {
  carrier: string | null
  carrierName: string | null
  waybillNo: string | null
  pickupStatus: "none" | "requested" | "picked_up" | "cancelled"
  pickedUpAt: string | null
  arrivedAt: string | null
  inspectedAt: string | null
  settledAt: string | null
}

export interface ReturnRequestInput {
  requestId: string
  items: { itemId: string; quantity: number }[]
  reason: string
  note?: string
  /** 교환 신청이면 "exchange". 반품은 비워 둔다(본문에 kind 칸을 싣지 않는다). */
  kind?: "exchange"
}
