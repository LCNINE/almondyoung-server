"use client"

import type {
  StoreFulfillmentStatus,
  StoreOrderActionsResponse,
  StoreRefundStatus,
} from "@/lib/api/orders/store-orders"
import { cn } from "@/lib/utils"

interface BadgeProps {
  label: string
  color: string
}

function StatusBadge({ label, color }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap",
        color
      )}
    >
      {label}
    </span>
  )
}

// ── 주문 상태 badge ─────────────────────────────────────────────────────

const ORDER_STATUS_MAP: Record<string, BadgeProps> = {
  // pending = WMS 처리 전 단계. 결제 수단별 문구는 getCoreDisplayStatus에서 paymentStatus로 분기.
  pending:    { label: "결제 완료",   color: "bg-blue-100 text-blue-700" },
  confirmed:  { label: "결제 완료",   color: "bg-blue-100 text-blue-700" },
  processing: { label: "준비 중",     color: "bg-blue-100 text-blue-700" },
  shipped:    { label: "배송 중",     color: "bg-green-100 text-green-700" },
  delivered:  { label: "배송 완료",   color: "bg-green-100 text-green-700" },
  cancelled:  { label: "취소됨",      color: "bg-gray-100 text-gray-500" },
  timeout:    { label: "시간 초과",   color: "bg-gray-100 text-gray-400" },
}

// ── 출고 상태 badge ─────────────────────────────────────────────────────

const FULFILLMENT_STATUS_MAP: Record<StoreFulfillmentStatus, BadgeProps | null> = {
  not_created:      null,
  awaiting_matching:{ label: "매칭 대기", color: "bg-orange-100 text-orange-600" },
  created:          { label: "출고 대기", color: "bg-gray-100 text-gray-500" },
  picking:          { label: "피킹 중",   color: "bg-indigo-100 text-indigo-600" },
  packed:           { label: "패킹 완료", color: "bg-indigo-100 text-indigo-600" },
  shipped:          { label: "배송 중",   color: "bg-green-100 text-green-600" },
  delivered:        { label: "배송 완료", color: "bg-green-100 text-green-700" },
  canceled:         { label: "출고 취소", color: "bg-gray-100 text-gray-400" },
}

// ── 환불 상태 badge ─────────────────────────────────────────────────────

const REFUND_STATUS_MAP: Record<StoreRefundStatus, BadgeProps | null> = {
  none:           null,
  pending:        { label: "환불 처리 중",     color: "bg-amber-100 text-amber-700" },
  manual_pending: { label: "환불 수동 처리 대기", color: "bg-amber-100 text-amber-700" },
  succeeded:      { label: "환불 완료",        color: "bg-green-100 text-green-700" },
  failed:         { label: "환불 실패",         color: "bg-red-100 text-red-600" },
}

// ── Medusa payment_status → i18n 키 매핑 ───────────────────────────────

const PAYMENT_STATUS_KEY_MAP: Record<string, string> = {
  awaiting: "awaiting",
  requires_action: "requires_action",
  authorized: "authorized",
  captured: "captured",
  paid: "captured",
  partially_refunded: "partially_refunded",
  refunded: "refunded",
  canceled: "canceled",
  cancelled: "canceled",
  failed: "failed",
}

/**
 * Medusa payment_status를 i18n 키로 변환한다.
 * 알 수 없는 값은 "unknown"을 반환하고 콘솔에 경고를 남긴다.
 */
export function getPaymentStatusI18nKey(status: string): string {
  if (status in PAYMENT_STATUS_KEY_MAP) return PAYMENT_STATUS_KEY_MAP[status]!
  if (typeof window !== "undefined") {
    console.warn(`[OrderDetails] Unknown payment_status: "${status}"`)
  }
  return "unknown"
}

// ── 취소 불가 사유 메시지 ─────────────────────────────────────────────

export const CANCEL_UNAVAILABLE_MESSAGES: Record<string, string> = {
  already_shipped:    "이미 출고된 주문입니다. 반품 신청을 이용해 주세요.",
  already_cancelled:  "이미 취소된 주문입니다.",
  channel_order:      "채널 주문은 해당 채널에서 취소해 주세요.",
  already_processing: "피킹이 시작되어 직접 취소가 불가합니다. 고객센터로 문의해 주세요.",
}

// ── Core 상태 → 고객 표시 텍스트 변환 ──────────────────────────────────
// 실제 로직은 순수 모듈(order-status-display.ts)에 있고, 기존 import 경로 호환을 위해 재export.
export { getCoreDisplayStatus } from "./order-status-display"

// ── 복합 badge 컴포넌트 ───────────────────────────────────────────────

interface OrderStatusBadgesProps {
  actions?: StoreOrderActionsResponse
  /** Medusa order status fallback */
  medusaStatus?: string
}

export function OrderStatusBadges({ actions, medusaStatus }: OrderStatusBadgesProps) {
  if (!actions) {
    // Core 데이터 없을 때 Medusa 상태만 표시
    if (!medusaStatus) return null
    const badge = ORDER_STATUS_MAP[medusaStatus]
    return badge ? <StatusBadge {...badge} /> : null
  }

  const orderBadge = ORDER_STATUS_MAP[actions.orderStatus]
  const fulfillBadge = FULFILLMENT_STATUS_MAP[actions.fulfillmentStatus]
  const refundBadge = REFUND_STATUS_MAP[actions.refundStatus]

  return (
    <div className="flex flex-wrap gap-1">
      {orderBadge && <StatusBadge {...orderBadge} />}
      {fulfillBadge && <StatusBadge {...fulfillBadge} />}
      {refundBadge && <StatusBadge {...refundBadge} />}
    </div>
  )
}
