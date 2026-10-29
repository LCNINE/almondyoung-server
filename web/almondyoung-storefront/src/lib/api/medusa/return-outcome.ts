import type {
  StoreReturnErrorDto,
  StoreReturnListResponseDto,
  StoreReturnRequestDto,
  StoreReturnRequestResponseDto,
  StoreReturnableResponseDto,
} from "@lib/types/dto/returns"
import type {
  CustomerReturn,
  ReturnRequestInput,
  ReturnableLine,
} from "@lib/types/ui/returns"

// 순수 함수만 둔다("use server" 파일은 async 함수만 export 가능, vitest 로 검증).

export type ReturnRequestOutcome =
  | { kind: "requested"; returnId: string }
  | { kind: "canceled_replay" }
  | { kind: "rejected"; reason: string }
  | { kind: "unavailable" }
  | { kind: "not_found" }
  | { kind: "unknown" }

export type ReturnCancelOutcome =
  | { kind: "canceled" }
  | { kind: "rejected"; reason: string }
  | { kind: "not_found" }
  | { kind: "unknown" }

export function toReturnRequestBody(
  input: ReturnRequestInput
): StoreReturnRequestDto {
  const note = input.note?.trim()
  return {
    request_id: input.requestId,
    items: input.items.map((i) => ({
      item_id: i.itemId,
      quantity: i.quantity,
    })),
    reason: input.reason,
    ...(note ? { note } : {}),
    // 반품 본문에는 kind 칸 자체를 싣지 않는다 — 있던 반품 요청의 해시가 바뀌지 않게.
    ...(input.kind === "exchange" ? { kind: "exchange" as const } : {}),
  }
}

export function requestOutcomeFromResponse(
  res: StoreReturnRequestResponseDto
): ReturnRequestOutcome {
  if (res.status === "requested")
    return { kind: "requested", returnId: res.return_id }
  if (res.status === "canceled") return { kind: "canceled_replay" }
  return { kind: "unknown" }
}

export function requestOutcomeFromError(
  status: number | null,
  data: StoreReturnErrorDto | undefined
): ReturnRequestOutcome {
  if (status === 400 && data?.code === "return_rejected" && data.reason)
    return { kind: "rejected", reason: data.reason }
  if (status === 502 && data?.type === "core_unavailable")
    return { kind: "unavailable" }
  if (status === 404) return { kind: "not_found" }
  return { kind: "unknown" }
}

export function cancelOutcomeFromError(
  status: number | null,
  data: StoreReturnErrorDto | undefined
): ReturnCancelOutcome {
  if (status === 400 && data?.reason)
    return { kind: "rejected", reason: data.reason }
  if (status === 404) return { kind: "not_found" }
  return { kind: "unknown" }
}

export function toReturnableLines(
  dto: StoreReturnableResponseDto
): ReturnableLine[] {
  return dto.items.map((i) => ({
    itemId: i.item_id,
    returnableQuantity: i.returnable_quantity,
    windowEndsAt: i.window_ends_at,
    exchangeable: i.exchangeable === true,
  }))
}

export function toCustomerReturns(
  dto: StoreReturnListResponseDto
): CustomerReturn[] {
  return dto.returns.map((r) => ({
    returnId: r.return_id,
    kind: r.kind === "exchange" ? "exchange" : "return",
    stage: r.stage,
    requestedAt: r.requested_at,
    reason: r.reason,
    feeBearer: r.fee_bearer,
    items: r.items.map((i) => ({ itemId: i.item_id, quantity: i.quantity })),
    canCancel: r.can_cancel,
    refund: r.refund
      ? {
          itemTotal: r.refund.item_total,
          shippingRefund: r.refund.shipping_refund,
          fees: r.refund.fees,
          total: r.refund.total,
          receivedAt: r.refund.received_at,
          refundedAt: r.refund.refunded_at,
        }
      : null,
  }))
}
