"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import type { SavingsData } from "../../types/mypage-types"

interface SavingsBannerProps {
  initialData: SavingsData
}

export function SavingsBanner({ initialData }: SavingsBannerProps) {
  const t = useTranslations("mypage.banner")

  if (!initialData.hasSubscription) {
    return null
  }

  const { totalSavings, tierName } = initialData

  return (
    <LocalizedClientLink href="/mypage/membership">
      <section
        aria-label={t("savingsAriaLabel")}
        className="flex items-center justify-between rounded-lg bg-yellow-100 p-3 text-sm transition-opacity hover:opacity-80"
      >
        <div className="flex items-center gap-2">
          {tierName && (
            <span className="rounded bg-purple-200 px-2 py-0.5 text-xs font-bold text-purple-800">
              {tierName}
            </span>
          )}
          <p className="font-semibold">
            {t.rich("savingsThisMonth", {
              amount: totalSavings.toLocaleString(),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </div>
        <ChevronRight className="h-5 w-5" />
      </section>
    </LocalizedClientLink>
  )
}
