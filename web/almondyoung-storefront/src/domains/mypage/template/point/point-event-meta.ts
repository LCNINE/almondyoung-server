import type { PointEventType } from "@/lib/types/dto/wallet"
import { formatDate } from "@/lib/utils/format-date"

type StatusTone = "success" | "neutral" | "danger" | "info"

export interface PointEventMeta {
  title: string
  status: {
    label: string
    tone: StatusTone
  }
}

const META: Record<PointEventType, PointEventMeta> = {
  EARN: {
    title: "포인트 적립",
    status: { label: "완료", tone: "success" },
  },
  REDEEM: {
    title: "포인트 사용",
    status: { label: "완료", tone: "success" },
  },
  EARN_CANCEL: {
    title: "적립 취소",
    status: { label: "취소", tone: "neutral" },
  },
  REDEEM_CANCEL: {
    title: "사용 취소",
    status: { label: "환불", tone: "info" },
  },
}

export function getPointEventMeta(eventType: PointEventType): PointEventMeta {
  return (
    META[eventType] ?? {
      title: "포인트 변동",
      status: { label: "완료", tone: "success" },
    }
  )
}

export function formatPointAmount(amount: number): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : ""
  const abs = Math.abs(amount).toLocaleString("ko-KR")
  return `${sign} ${abs}`
}

export function formatPointDate(iso: string): string {
  return formatDate(iso, undefined, "")
}
