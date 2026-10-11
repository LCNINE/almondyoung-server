import type { RefundTone } from "@/lib/orders/refund-status"

// 환불 알약(상세 머리)과 «환불 상태» 글자색. 빨강은 실제 오류에만(DESIGN.md 원칙 4).
export const REFUND_TONE_BADGE_CLASS: Record<RefundTone, string> = {
  progress: "bg-amber-100 text-amber-700",
  done: "bg-green-100 text-green-700",
  problem: "bg-red-100 text-red-600",
}

export const REFUND_TONE_TEXT_CLASS: Record<RefundTone, string> = {
  progress: "text-amber-600",
  done: "text-green-600",
  problem: "text-red-500",
}
