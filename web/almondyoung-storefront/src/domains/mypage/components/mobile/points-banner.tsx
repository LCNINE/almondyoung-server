"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import type { PointBalanceData } from "../../types/mypage-types"

interface PointsBannerProps {
  initialData: PointBalanceData
}

export function PointsBanner({ initialData }: PointsBannerProps) {
  const t = useTranslations("mypage.banner")
  const available = initialData.available
  const hasRecentActivity = available > 0

  return (
    <LocalizedClientLink href="/mypage/point">
      <section className="my-3 flex w-full items-center justify-between rounded-[10px] bg-white px-4 py-3.5 shadow-sm transition-opacity hover:opacity-80">
        <p className="text-[11px] font-medium text-[#2c2c2e]">
          {hasRecentActivity ? t("pointTitle") : t("pointEmpty")}
        </p>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-black">{t("pointLabel")}</span>
            <span className="text-sm font-bold text-black">
              {t("pointAmount", { amount: available.toLocaleString() })}
            </span>
          </div>

          <ChevronRight className="h-[18px] w-[18px] text-[#757575]" />
        </div>
      </section>
    </LocalizedClientLink>
  )
}
