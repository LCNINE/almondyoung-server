"use client"

import { Progress } from "@/components/ui/progress"
import { useShippingGroups } from "@/contexts/shipping-groups-context"
import { cn } from "@/lib/utils"
import { formatPrice } from "@/lib/utils/price-utils"
import { useTranslations } from "next-intl"
import { useMemo } from "react"

import {
  buildFreeShippingProgress,
  type FreeShippingLineItem,
} from "../../utils/build-free-shipping-progress"

interface FreeShippingProgressProps {
  /** 진행률 판정에 쓸 카트 라인. 배송비 그룹별로 나눠 계산한다. */
  items: FreeShippingLineItem[] | null | undefined
  className?: string
}

/**
 * 배송비 그룹별 무료배송 진행바.
 *
 * 무료 기준 금액은 서버(배송비 그룹 정책)에서 온다 — 예전엔 50,000 이 컴포넌트 상수로 박혀 있어
 * 그룹마다 기준이 다르면 거짓말을 했다. 그룹이 2개 이상이면 그룹마다 한 줄씩 그린다.
 */
export function FreeShippingProgress({
  items,
  className,
}: FreeShippingProgressProps) {
  const t = useTranslations("cart.freeShipping")
  const groups = useShippingGroups()
  const entries = useMemo(
    () => buildFreeShippingProgress(items, groups),
    [items, groups]
  )

  if (entries.length === 0) return null

  const showGroupName = entries.length > 1

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {entries.map((entry) => (
        <div key={entry.groupCode} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            {entry.reached ? (
              <span className="font-medium text-primary">
                {showGroupName
                  ? t("reachedInGroup", { group: entry.groupName })
                  : t("reached")}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {showGroupName
                  ? t("remainingInGroup", {
                      group: entry.groupName,
                      amount: formatPrice(entry.remaining),
                    })
                  : t("remaining", { amount: formatPrice(entry.remaining) })}
              </span>
            )}
            <span className="text-muted-foreground">{entry.percent}%</span>
          </div>
          <Progress value={entry.percent} className="h-1.5" />
        </div>
      ))}
    </div>
  )
}
