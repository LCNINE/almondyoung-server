import type { HttpTypes } from "@medusajs/types"
import { getCoreDisplayStatus } from "@/components/orders/order-status-display"
import {
  getOrderActionsByMedusaId,
  type StoreOrderActionsResponse,
} from "@/lib/api/orders/store-orders"
import { isCancelledByCore } from "@/lib/orders/core-order-view"
import type { OrderStatus } from "../../../types/mypage-types"
import { withMypageTimeout } from "./mypage-timeout"

const getOrderStatusLabel = (order: HttpTypes.StoreOrder): string => {
  if (order.status === "canceled") return "취소됨"
  if (order.payment_status === "awaiting") return "결제 대기"
  if (order.fulfillment_status === "fulfilled") return "배송 완료"
  if (order.fulfillment_status === "shipped") return "배송 중"
  if (order.fulfillment_status === "partially_fulfilled") return "부분 배송"
  if (order.fulfillment_status === "not_fulfilled") return "상품 준비 중"
  return "결제 완료"
}

export const resolveMypageShippingStatus = (order: HttpTypes.StoreOrder) => {
  const statusLabel = getOrderStatusLabel(order)

  if (statusLabel === "배송 중" || statusLabel === "부분 배송") {
    return { statusLabel, status: "SHIPPING" as OrderStatus }
  }

  if (statusLabel === "상품 준비 중") {
    return { statusLabel, status: "PREPARING" as OrderStatus }
  }

  return null
}

/**
 * 마이페이지 홈에서 표시할 주문의 실제 상태 라벨과 core 취소 여부를 계산한다.
 * 주문내역(order-list)과 동일하게 Core(WMS) projection 기반 getCoreDisplayStatus 를 우선 사용하고,
 * Core 조회 실패/타임아웃 시 Medusa 기반 fallback 라벨을 사용한다.
 * core 가 취소를 확정한 주문은 Medusa 가 아직 canceled 가 아니어도 홈 카드에서 뺀다(#1016 36번 PR 6).
 */
export async function resolveMypageCoreView(
  order: HttpTypes.StoreOrder,
  fallbackLabel: string
): Promise<{ statusLabel: string; cancelledByCore: boolean }> {
  const actions = await withMypageTimeout<StoreOrderActionsResponse | null>(
    getOrderActionsByMedusaId(order.id),
    null,
    3000
  )
  return actions
    ? { statusLabel: getCoreDisplayStatus(actions), cancelledByCore: isCancelledByCore(actions) }
    : { statusLabel: fallbackLabel, cancelledByCore: false }
}
