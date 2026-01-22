import * as React from "react"

import { cn } from "@lib/utils"

type ProductMembershipBadgeSize = "sm" | "md" | "lg"

const sizeStyles: Record<
  ProductMembershipBadgeSize,
  { text: string; dot: string }
> = {
  sm: { text: "text-[11px]", dot: "h-2.5 w-2.5 text-[8px]" },
  md: { text: "text-[13px]", dot: "h-3 w-3 text-[10px]" },
  lg: { text: "text-[15px]", dot: "h-3.5 w-3.5 text-[11px]" },
}

type ProductMembershipBadgeProps = {
  size?: ProductMembershipBadgeSize
  label?: string
  className?: string
  dotClassName?: string
}

export function ProductMembershipBadge({
  size = "md",
  label = "멤버십 할인가",
  className,
  dotClassName,
}: ProductMembershipBadgeProps) {
  const styles = sizeStyles[size]

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-bold text-[#F2994A]",
        styles.text,
        className
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full bg-[#F2994A] text-white",
          styles.dot,
          dotClassName
        )}
      >
        ✓
      </span>
      {label}
    </span>
  )
}
