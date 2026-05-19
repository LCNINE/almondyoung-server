"use client"

import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { formatPrice } from "@/lib/utils/price-utils"
import { useTranslations } from "next-intl"

const FREE_SHIPPING_THRESHOLD = 50_000

interface FreeShippingProgressProps {
  itemSubtotal: number
  className?: string
}

export function FreeShippingProgress({ itemSubtotal, className }: FreeShippingProgressProps) {
  const t = useTranslations("cart.freeShipping")
  const reached = itemSubtotal >= FREE_SHIPPING_THRESHOLD
  const progress = Math.min(100, Math.round((itemSubtotal / FREE_SHIPPING_THRESHOLD) * 100))

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between text-xs">
        {reached ? (
          <span className="font-medium text-primary">{t("reached")}</span>
        ) : (
          <span className="text-muted-foreground">
            {t("remaining", {
              amount: formatPrice(FREE_SHIPPING_THRESHOLD - itemSubtotal),
            })}
          </span>
        )}
        <span className="text-muted-foreground">{progress}%</span>
      </div>
      <Progress value={progress} className="h-1.5" />
    </div>
  )
}
