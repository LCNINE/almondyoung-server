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
        "inline-flex w-fit shrink-0 items-center rounded-lg bg-[#ff3b20] px-2.5 py-1.5 text-[13px] leading-none font-bold text-white",
        className
      )}
    >
      {t("discountBadge", { percent })}
    </span>
  )
}
