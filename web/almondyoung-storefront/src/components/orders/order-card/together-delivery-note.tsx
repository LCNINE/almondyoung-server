"use client"

import { useTranslations } from "next-intl"

import type { AddToDeliveryLink } from "@lib/api/medusa/add-to-delivery"

interface TogetherDeliveryNoteProps {
  link: AddToDeliveryLink
  /** 부모 카드 안에 묶여 그려지면 true — "위 주문과" 로 말한다 */
  grouped: boolean
  /** 이 주문이 취소된 부모인지 */
  canceled: boolean
}

/** 주문 카드 아래 함께 배송 안내. 말할 게 없으면 그리지 않는다. */
export default function TogetherDeliveryNote({
  link,
  grouped,
  canceled,
}: TogetherDeliveryNoteProps) {
  const t = useTranslations("mypage.order.togetherDelivery")
  const lines = noteLines(link, grouped, canceled, t)

  if (lines.length === 0) return null

  return (
    <div
      className="bg-muted rounded-xl px-4 py-3 text-sm"
      data-testid="together-delivery-note"
    >
      {lines.map((line, i) => (
        <p
          key={line}
          className={i === 0 ? "text-foreground font-bold" : "text-muted-foreground"}
        >
          {line}
        </p>
      ))}
    </div>
  )
}

function noteLines(
  link: AddToDeliveryLink,
  grouped: boolean,
  canceled: boolean,
  t: (key: string, values?: Record<string, string | number>) => string
): string[] {
  const amount = (n: number) => n.toLocaleString()

  if (link.parentOrderId) {
    if (link.parentCanceled) {
      return [
        t("separate"),
        // 판매자 탓 취소(배송 지연 등)는 부모 환불에서 빼지 않았다 — 실제로 뺀 금액이 있을 때만 말한다
        ...(link.parentWithheldAmount > 0
          ? [t("separateDeducted", { amount: amount(link.waivedAmount) })]
          : []),
      ]
    }

    const head =
      grouped || link.parentDisplayId === null
        ? t("withParent")
        : t("withParentNumber", { displayId: link.parentDisplayId })

    return [
      head,
      ...(link.waivedAmount > 0
        ? [t("waived", { amount: amount(link.waivedAmount) })]
        : []),
    ]
  }

  if (canceled && link.withheldAmount > 0) {
    return [
      t("parentDeducted", { amount: amount(link.withheldAmount) }),
      t("parentRefundBack"),
    ]
  }

  return []
}
