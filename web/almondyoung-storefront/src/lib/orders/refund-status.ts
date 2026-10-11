import type { StoreOrderActionsResponse, StoreRefundStatus } from "@/lib/api/orders/store-orders"

/**
 * 환불 배지의 판정(#1016 36번 재설계 PR 4, 스펙 §8.2).
 *
 * core 는 스토어프론트보다 먼저 `refundStatus` 값을 늘린다. 모르는 값을 그대로 쓰면 배지는 조용히 사라지고
 * 상세엔 i18n 키 문자열(`mypage.order.refundInfo.statusLabels.…`)이 찍힌다 — 그래서 «환불 처리 중»으로 접는다.
 */

export type RefundTone = "progress" | "done" | "problem"

// 알려진 값의 정본. 타입에 값을 더하면 여기서 컴파일 에러가 난다.
const TONE: Record<StoreRefundStatus, RefundTone | null> = {
  none: null,
  pending: "progress",
  manual_pending: "progress",
  // 고객에게는 지연과 거절을 구분하지 않는다(스펙 §5.2) — 빨강은 «환불을 안 해 준다»로 읽힌다
  delayed: "progress",
  transfer_pending: "progress",
  succeeded: "done",
  // core 직접 주문의 환불 실패(스펙 §2.4). 이 재설계 범위 밖이라 그대로 둔다
  failed: "problem",
}

// `in` 은 프로토타입 이름(toString 등)을 알려진 값으로 통과시킨다
function isKnownRefundStatus(value: string): value is StoreRefundStatus {
  return Object.prototype.hasOwnProperty.call(TONE, value)
}

export const KNOWN_REFUND_STATUSES: readonly StoreRefundStatus[] = Object.keys(TONE).filter(isKnownRefundStatus)

/** 값이 없으면 none(환불 정보 없음), 모르는 값이면 pending. */
export function toRefundStatus(raw: string | null | undefined): StoreRefundStatus {
  if (raw == null) return "none"
  return isKnownRefundStatus(raw) ? raw : "pending"
}

/** 주문 상세가 보는 값 — 환불 요약이 있으면 그 상태가 우선이다. */
export function resolveRefundStatus(
  actions: Pick<StoreOrderActionsResponse, "refundStatus" | "refundSummary"> | null | undefined
): StoreRefundStatus {
  return toRefundStatus(actions?.refundSummary?.status ?? actions?.refundStatus)
}

export function refundTone(status: StoreRefundStatus): RefundTone | null {
  return TONE[status]
}
