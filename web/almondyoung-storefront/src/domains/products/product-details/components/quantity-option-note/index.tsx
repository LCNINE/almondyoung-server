"use client"

import { PackagePlus } from "lucide-react"
import LocalizedClientLink from "@/components/shared/localized-client-link"
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

/** 옵션 선택 전에는 수량 할인 혜택을 강조하고, 선택 후에는 대상 여부를 안내한다. */
export default function QuantityOptionNote({
  kind,
  summary,
  optionLabel,
  className,
}: QuantityOptionNoteProps) {
  const t = useTranslations("productDetail.quantityDiscount")
  if (kind === "notEligible") {
    return (
      <p className={cn("text-muted-foreground text-[13px]", className)}>
        {optionLabel
          ? t("notEligibleOption", { option: optionLabel })
          : t("notEligible")}
      </p>
    )
  }
  return (
    <section
      className={cn(
        "border-mint-deep/40 bg-mint-tint/50 rounded-2xl border-2 p-4",
        className
      )}
      aria-label={t("title")}
    >
      <h3 className="text-foreground flex items-center gap-2 text-base font-bold">
        <PackagePlus
          aria-hidden="true"
          className="text-mint-deep size-6 shrink-0"
        />
        {t("bundleTitle")}
      </h3>
      <p className="text-foreground mt-2 text-sm font-semibold">
        {t(
          summary.pricesHidden
            ? "hiddenMemberOffer"
            : summary.memberOnly
              ? "optionSummaryMember"
              : "optionSummary",
          {
            count: summary.minQuantity,
            percent: summary.percent,
          }
        )}
      </p>
      <p className="text-muted-foreground mt-2 text-sm">
        {t("chooseOptionFirst")}
      </p>
      <p className="text-muted-foreground mt-1 text-xs">{t("basis")}</p>
      {summary.memberOnly && (
        <LocalizedClientLink
          href="/mypage/membership"
          className="text-mint-deep mt-3 inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4"
        >
          {t("joinForBundle")}
        </LocalizedClientLink>
      )}
    </section>
  )
}
