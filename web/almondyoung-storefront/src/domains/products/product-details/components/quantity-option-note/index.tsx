"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import type { ProductTierSummary } from "@/lib/utils/quantity-discount"

type QuantityOptionNoteProps = {
  kind: "summary" | "notEligible"
  summary: ProductTierSummary
  /** 고른 옵션 이름. 있으면 «빨강 옵션은 …»처럼 어느 옵션인지 적는다(여러 옵션을 함께 고른 화면에서 헷갈리지 않게). */
  optionLabel?: string
  className?: string
}

/** 옵션마다 수량 할인이 다를 때 묶음 카드 자리에 보이는 한 줄. */
export default function QuantityOptionNote({ kind, summary, optionLabel, className }: QuantityOptionNoteProps) {
  const t = useTranslations("productDetail.quantityDiscount")
  if (kind === "notEligible") {
    return (
      <p className={cn("text-muted-foreground text-[13px]", className)}>
        {optionLabel ? t("notEligibleOption", { option: optionLabel }) : t("notEligible")}
      </p>
    )
  }
  return (
    <p className={cn("bg-muted text-foreground rounded-lg px-3 py-2 text-[13px]", className)}>
      {t(summary.memberOnly ? "optionSummaryMember" : "optionSummary", {
        count: summary.minQuantity,
        percent: summary.percent,
      })}
    </p>
  )
}
