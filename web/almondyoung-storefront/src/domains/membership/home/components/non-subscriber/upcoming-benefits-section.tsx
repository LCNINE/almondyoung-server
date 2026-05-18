"use client"

import { useTranslations } from "next-intl"
import BenefitListItem from "./benefit-list-item"
import { useUpcomingBenefits } from "./benefits-data"

export default function UpcomingBenefitsSection() {
  const t = useTranslations("mypage.membership.benefits")
  const upcomingBenefits = useUpcomingBenefits()
  return (
    <section className="py-12">
      <div className="mb-8 flex flex-col items-center gap-4">
        <h2 className="text-center text-2xl font-bold md:text-3xl">
          <span className="text-white">{t("upcomingTitle1")}</span>
          <span className="text-[#f29219]">{t("upcomingTitle2")}</span>
        </h2>
        <p className="text-center text-sm text-white/60">
          {t("upcomingDescription")}
        </p>
      </div>

      <div className="space-y-2">
        {upcomingBenefits.map((benefit) => (
          <BenefitListItem key={benefit.id} benefit={benefit} />
        ))}
      </div>
    </section>
  )
}
