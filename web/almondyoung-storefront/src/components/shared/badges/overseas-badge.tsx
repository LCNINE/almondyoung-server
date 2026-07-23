"use client"

import { cn } from "@lib/utils"
import { useTranslations } from "next-intl"

/** 해외 배송(해외직구) 상품 표시. 상품명 앞에 인라인으로 붙인다. */
export function OverseasBadge({ className }: { className?: string }) {
  const t = useTranslations("productCard")

  return (
    <span
      className={cn(
        "mr-1 inline-flex shrink-0 items-center rounded bg-[#2f6cd4] px-1 py-px align-middle text-[11px] font-medium leading-[1.4] text-white",
        className
      )}
    >
      {t("overseasBadge")}
    </span>
  )
}
