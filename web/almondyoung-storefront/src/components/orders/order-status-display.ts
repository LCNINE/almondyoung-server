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

// not_created·canceled 는 문구를 정하지 않는다 — 결제 수단·SO 상태 라벨로 내려간다(K6 PR5)
const PHASE_LABELS: Partial<Record<StoreFulfillmentStatus, string>> = {
  preparing: "상품 준비 중",
  shipping: "배송 중",
  delivered: "배송 완료",
}

// SO shipped·delivered 는 셀메이트가 core 밖에서 출고했다는 표지다
const EXTERNALLY_SHIPPED = new Set(["shipped", "delivered"])

/**
 * 주문 상태 뱃지에 쓸 SO 상태. SO 가 shipped·delivered 면 core 가 그 사실을 진행 단계(shipping·delivered)에 이미 담아
 * 보내므로 뱃지를 그리지 않는다 — 같이 그리면 «배송 중»이 두 번 뜨거나 «배송 중»+«배송 완료»가 붙는다(K6 PR5).
 */
export function orderBadgeStatus(actions: Pick<StoreOrderActionsResponse, "orderStatus">): string | null {
  return EXTERNALLY_SHIPPED.has(actions.orderStatus) ? null : actions.orderStatus
}

/**
 * Core action projection에서 고객 화면 주 상태 텍스트를 도출한다.
 * 진행 단계 > paymentStatus 분기 > SO 상태 순으로 우선 적용.
 */
export function getCoreDisplayStatus(actions: StoreOrderActionsResponse): string {
  // 진행 단계가 더 구체적이면 우선 표시
  const phaseLabel = PHASE_LABELS[actions.fulfillmentStatus]
  if (phaseLabel) return phaseLabel

  // pending 주문은 결제 수단별로 문구 분기
  // paymentStatus가 없으면 카드결제 등 이미 확인된 결제 → "결제 완료"
  if (actions.orderStatus === "pending") {
    return actions.paymentStatus === "awaiting_payment" ? "입금 대기" : "결제 완료"
  }

  return ORDER_STATUS_LABELS[actions.orderStatus] ?? actions.orderStatus
}
