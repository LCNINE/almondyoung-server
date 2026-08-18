"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { formatPrice } from "@/lib/utils/price-utils"
import type { ShippingGroupNoticeContent } from "@/lib/utils/shipping-group-notice"
import { CircleHelp } from "lucide-react"
import { useTranslations } from "next-intl"

interface ShippingGroupNoticeLineProps {
  notice: ShippingGroupNoticeContent | null
  className?: string
}

/**
 * 개별 배송비 그룹 안내 한 줄. 문구는 상품 상세·장바구니·주문서가 공유한다.
 * 어드민이 그룹에 고객 안내 문구를 넣어두면 (?) 아이콘을 붙이고 호버/탭에 그대로 보여준다.
 */
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
    <p className={cn("text-muted-foreground text-xs", className)}>
      {text}
      {notice.description && (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("descriptionAria")}
                className="ml-1 inline-flex translate-y-[2.5px] cursor-help align-baseline"
              >
                <CircleHelp className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64 whitespace-pre-line">
              {notice.description}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </p>
  )
}
