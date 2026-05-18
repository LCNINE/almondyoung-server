"use client"

import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { formatPrice } from "@/lib/utils/price-utils"

const FREE_SHIPPING_THRESHOLD = 50_000

interface FreeShippingProgressProps {
  itemSubtotal: number
  className?: string
}

export function FreeShippingProgress({ itemSubtotal, className }: FreeShippingProgressProps) {
  const reached = itemSubtotal >= FREE_SHIPPING_THRESHOLD
  const progress = Math.min(100, Math.round((itemSubtotal / FREE_SHIPPING_THRESHOLD) * 100))

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between text-xs">
        {reached ? (
          <span className="font-medium text-primary">무료배송 혜택이 적용됩니다!</span>
        ) : (
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{formatPrice(FREE_SHIPPING_THRESHOLD - itemSubtotal)}원</span> 더 담으면 무료배송
          </span>
        )}
        <span className="text-muted-foreground">{progress}%</span>
      </div>
      <Progress value={progress} className="h-1.5" />
    </div>
  )
}
