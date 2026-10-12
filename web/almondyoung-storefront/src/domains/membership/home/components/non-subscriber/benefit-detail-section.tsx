"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslations } from "next-intl"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { BenefitAreaLine } from "@/domains/beautytop/area/benefit-area-line"
import { useCurrentBenefits } from "./benefits-data"

export default function BenefitDetailSection() {
  const t = useTranslations("mypage.membership.benefits")
  const currentBenefits = useCurrentBenefits()
  return (
    <section className="py-12">
      <div className="flex flex-col items-center gap-4 mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-center">
          <span className="text-white">{t("detailTitle1")}</span>
          <span className="text-[#ffa500]">{t("detailTitle2")}</span>
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {currentBenefits.map((benefit) => (
          <Card
            key={benefit.id}
            id={benefit.id}
            className="bg-zinc-800 border-white/10 scroll-mt-24"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <span className="text-[#ffa500] text-lg font-bold">
                  {benefit.number}
                </span>
                <CardTitle className="text-white text-base">
                  {benefit.title}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-white/70 text-sm leading-relaxed">
                {benefit.description}
              </p>
              {benefit.teaser === "beautytopArea" && <BenefitAreaLine />}
              {benefit.link && (
                <LocalizedClientLink
                  href={benefit.link.href}
                  className="mt-3 inline-flex items-center gap-1 rounded-sm text-sm font-medium text-white underline underline-offset-4 transition-colors hover:text-white/80 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
                >
                  {benefit.link.text}
                  <span aria-hidden="true">→</span>
                </LocalizedClientLink>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
