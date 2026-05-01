import * as React from "react"

import { cn } from "@lib/utils"

type LowStockBadgeSize = "sm" | "md" | "lg"

const sizeStyles: Record<
  LowStockBadgeSize,
  { text: string; icon: string; iconText: string }
> = {
  sm: { text: "text-[10px]", icon: "h-3 w-3", iconText: "text-[8px]" },
  md: { text: "text-[12px]", icon: "h-4 w-4", iconText: "text-[10px]" },
  lg: { text: "text-[14px]", icon: "h-5 w-5", iconText: "text-[12px]" },
}

type LowStockBadgeProps = {
  count: number
  size?: LowStockBadgeSize
  label?: string
  color?: string
  className?: string
  iconClassName?: string
}

export function LowStockBadge({
  count,
  size = "md",
  label = "잔여수량",
  color = "#F24E1E",
  className,
  iconClassName,
}: LowStockBadgeProps) {
  const styles = sizeStyles[size]

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap font-bold",
        styles.text,
        className
      )}
      style={{ color }}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full text-white",
          styles.icon,
          styles.iconText,
          iconClassName
        )}
        style={{ backgroundColor: color }}
      >
        !
      </span>
      {label} {count}개
    </span>
  )
}
