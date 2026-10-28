export interface ReturnableLine {
  itemId: string
  returnableQuantity: number
  windowEndsAt: string | null
}

export type CustomerReturnStage =
  | "requested"
  | "processing"
  | "refunded"
  | "canceled"

export interface CustomerReturn {
  returnId: string
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
}
