"use client"

import { cn } from "@/lib/utils"
import { formatPrice } from "@/lib/utils/price-utils"
import type { ShippingGroupNoticeContent } from "@/lib/utils/shipping-group-notice"
import { useTranslations } from "next-intl"

interface ShippingGroupNoticeLineProps {
  notice: ShippingGroupNoticeContent | null
  className?: string
}

/** 개별 배송비 그룹 안내 한 줄. 문구는 상품 상세·장바구니·주문서가 공유한다. */
export function ShippingGroupNoticeLine({
  notice,
  className,
}: ShippingGroupNoticeLineProps) {
  const t = useTranslations("cart.shippingGroup")

  if (!notice) return null

  const text =
    notice.key === "conditionalFree"
      ? t("conditionalFree", {
          group: notice.group,
          amount: formatPrice(notice.amount),
          threshold: formatPrice(notice.threshold),
        })
      : t(notice.key, {
          group: notice.group,
          amount: formatPrice(notice.amount),
        })

  return (
    <p className={cn("text-muted-foreground text-xs", className)}>{text}</p>
  )
}
