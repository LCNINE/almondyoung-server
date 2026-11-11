import * as React from "react"

import { cn } from "@lib/utils"

type ProductMembershipBadgeSize = "sm" | "md" | "lg"

const sizeStyles: Record<
  ProductMembershipBadgeSize,
  { text: string; icon: string }
> = {
  sm: { text: "text-[12px]", icon: "h-3.5 w-3.5" },
  md: { text: "text-[13px]", icon: "h-4 w-4" },
  lg: { text: "text-[15px]", icon: "h-[18px] w-[18px]" },
}

type ProductMembershipBadgeProps = {
  size?: ProductMembershipBadgeSize
  label?: string
  className?: string
}

export function ProductMembershipBadge({
  size = "md",
  label = "멤버십 할인가",
  className,
}: ProductMembershipBadgeProps) {
  const styles = sizeStyles[size]

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-bold whitespace-nowrap text-[#e08f00]",
        styles.text,
        className
      )}
    >
      <img
        src="/icons/membership-tick.svg"
        alt=""
        aria-hidden="true"
        className={cn("shrink-0", styles.icon)}
      />
      {label}
    </span>
  )
}
