"use client"

import { Badge } from "@/components/ui/badge"
import { useTranslations } from "next-intl"
import BenefitListItem from "./benefit-list-item"
import { useCurrentBenefits } from "./benefits-data"

interface BenefitOverviewSectionProps {
  onBenefitClick?: (benefitId: string) => void
}

export default function BenefitOverviewSection({
  onBenefitClick,
}: BenefitOverviewSectionProps) {
  const t = useTranslations("mypage.membership.benefits")
  const currentBenefits = useCurrentBenefits()
  return (
    <section className="py-12">
      <div className="mb-8 flex flex-col items-center gap-4">
        <Badge
          variant="outline"
          className="border-white/40 bg-transparent px-3 py-1 text-xs text-white"
        >
          MEMBERSHIP BENEFITS
        </Badge>
        <h2 className="text-center text-2xl font-bold md:text-3xl">
          <span className="text-white">{t("overviewTitle1")}</span>
          <span className="text-[#f29219]">{t("overviewTitle2")}</span>
        </h2>
        <p className="text-center text-sm text-white/60">
          {t("overviewHint1")}
          <br />
          {t("overviewHint2")}
        </p>
        <span className="text-lg text-white/40">▽</span>
      </div>

      <div className="space-y-2">
        {currentBenefits.map((benefit) => (
          <BenefitListItem
            key={benefit.id}
            benefit={benefit}
            onClick={() => onBenefitClick?.(benefit.id)}
          />
        ))}
      </div>
    </section>
  )
}
