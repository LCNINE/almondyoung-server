"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

export function DiscountBadge({
  percent,
  className,
}: {
  percent: number
  className?: string
}) {
  const t = useTranslations("productCard")

  if (percent <= 0) return null

  return (
    <span
      className={cn(
        "bg-red-30 inline-flex w-fit shrink-0 items-center rounded-[3px] px-1 py-0.5 text-xs leading-none font-medium text-white",
        className
      )}
    >
      {t("discountBadge", { percent })}
    </span>
  )
}
