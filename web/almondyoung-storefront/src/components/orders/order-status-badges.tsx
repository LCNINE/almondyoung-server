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
  pending:    { label: "결제 확인 중", color: "bg-yellow-100 text-yellow-700" },
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

// ── 취소 불가 사유 메시지 ─────────────────────────────────────────────

export const CANCEL_UNAVAILABLE_MESSAGES: Record<string, string> = {
  already_shipped:    "이미 출고된 주문입니다. 반품 신청을 이용해 주세요.",
  already_cancelled:  "이미 취소된 주문입니다.",
  channel_order:      "채널 주문은 해당 채널에서 취소해 주세요.",
  already_processing: "출고 준비 중으로 취소가 어려울 수 있습니다.",
}

// ── Core 상태 → 고객 표시 텍스트 변환 ──────────────────────────────────

const FO_DISPLAY_LABELS: Partial<Record<StoreFulfillmentStatus, string>> = {
  picking:   '출고 준비 중',
  packed:    '배송 예정',
  shipped:   '배송 중',
  delivered: '배송 완료',
}

/**
 * Core action projection에서 고객 화면 주 상태 텍스트를 도출한다.
 * FO 상태가 더 구체적일 때 우선 사용, 없으면 SO 상태로 대체.
 */
export function getCoreDisplayStatus(actions: StoreOrderActionsResponse): string {
  return (
    FO_DISPLAY_LABELS[actions.fulfillmentStatus] ??
    ORDER_STATUS_MAP[actions.orderStatus]?.label ??
    actions.orderStatus
  )
}

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
