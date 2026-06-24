import type {
  StoreFulfillmentStatus,
  StoreOrderActionsResponse,
} from "@/lib/api/orders/store-orders"

// Core 상태 → 고객 표시 텍스트 변환 로직.
// 'use client' 모듈(order-status-badges.tsx)에 두면 서버 컴포넌트에서 import 시
// export 가 client reference 로 바뀌어 서버 호출이 불가능해진다. 마이페이지 홈 wrapper
// (server component)에서도 주문내역과 동일한 상태 라벨을 쓰기 위해 순수 모듈로 분리한다.

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "결제 완료",
  confirmed: "결제 완료",
  processing: "준비 중",
  shipped: "배송 중",
  delivered: "배송 완료",
  cancelled: "취소됨",
  timeout: "시간 초과",
}

const FO_DISPLAY_LABELS: Partial<Record<StoreFulfillmentStatus, string>> = {
  picking: "출고 준비 중",
  packed: "배송 예정",
  shipped: "배송 중",
  delivered: "배송 완료",
}

/**
 * Core action projection에서 고객 화면 주 상태 텍스트를 도출한다.
 * FO 상태 > paymentStatus 분기 > SO 상태 순으로 우선 적용.
 */
export function getCoreDisplayStatus(actions: StoreOrderActionsResponse): string {
  // 출고 상태가 더 구체적이면 우선 표시
  const foLabel = FO_DISPLAY_LABELS[actions.fulfillmentStatus]
  if (foLabel) return foLabel

  // pending 주문은 결제 수단별로 문구 분기
  // paymentStatus가 없으면 카드결제 등 이미 확인된 결제 → "결제 완료"
  if (actions.orderStatus === "pending") {
    return actions.paymentStatus === "awaiting_payment" ? "입금 대기" : "결제 완료"
  }

  return ORDER_STATUS_LABELS[actions.orderStatus] ?? actions.orderStatus
}
