import type { StoreOrderActionsResponse } from "@/lib/api/orders/store-orders"
import { resolveRefundStatus } from "./refund-status"

type CoreActions = StoreOrderActionsResponse | null | undefined

/**
 * core 가 취소를 확정했다(#1016 36번 재설계 — 요청 순간 확정). Medusa 는 환불 정산이 끝나야 canceled 가 되므로
 * 그 사이 Medusa 필드를 그대로 비추면 «취소 완료»와 어긋난다. core 데이터가 없으면 거짓 — 지금 동작을 지킨다.
 */
export function isCancelledByCore(actions: Pick<StoreOrderActionsResponse, "orderStatus"> | null | undefined): boolean {
  return actions?.orderStatus === "cancelled"
}

/** «결제 상태» 줄에 넣을 결제 상태 값(`getPaymentStatusI18nKey` 의 입력). core 취소면 환불 완료는 refunded, 아니면 canceled */
export function paymentStatusForDisplay(medusaPaymentStatus: string, actions: CoreActions): string {
  if (!isCancelledByCore(actions)) return medusaPaymentStatus
  return resolveRefundStatus(actions) === "succeeded" ? "refunded" : "canceled"
}

/** «구매확정» — 결제 승인 상태의 무통장 입금 완료 주문만. core 취소 주문은 숨긴다(사용자 확인 2026-10-12: 중요하지 않다, 최소 변경) */
export function canConfirmPurchase(input: {
  paymentStatus: string
  isConfirmed: boolean
  awaitingDeposit: boolean
  actions: CoreActions
}): boolean {
  return input.paymentStatus === "authorized" && !input.isConfirmed && !input.awaitingDeposit && !isCancelledByCore(input.actions)
}

const MEDUSA_SHIPPED = new Set(["shipped", "fulfilled", "partially_fulfilled"])

/** «배송 조회» — core 가 track 을 주거나, core 취소가 아니고 Medusa 이행이 나간 상태 */
export function showTrackLink(input: {
  requiresShipping: boolean
  canTrack: boolean
  medusaFulfillmentStatus: string | null | undefined
  actions: CoreActions
}): boolean {
  if (!input.requiresShipping) return false
  if (input.canTrack) return true
  return !isCancelledByCore(input.actions) && MEDUSA_SHIPPED.has(input.medusaFulfillmentStatus ?? "")
}
