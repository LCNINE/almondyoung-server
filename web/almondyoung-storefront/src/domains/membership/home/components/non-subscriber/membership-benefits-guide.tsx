"use client"

import { useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { CustomButton } from "@/components/shared/custom-buttons"
import { Separator } from "@/components/ui/separator"
import BenefitDetailSection from "./benefit-detail-section"
import BenefitOverviewSection from "./benefit-overview-section"
import MembershipFAQSection from "./membership-faq-section"
import UpcomingBenefitsSection from "./upcoming-benefits-section"

interface MembershipBenefitsGuideProps {
  /** 히어로의 구독하기 CTA 노출 여부 (이미 회원이면 숨김) */
  showSubscribeCta?: boolean
}

/**
 * 멤버십 가입/혜택 안내 (마케팅) — 회원·비회원 모두 재사용.
 * `/mypage/membership/benefits` 라우트와 비회원 허브에서 공유한다.
 */
export default function MembershipBenefitsGuide({
  showSubscribeCta = true,
}: MembershipBenefitsGuideProps) {
  const router = useRouter()
  const params = useParams()
  const countryCode = (params?.countryCode as string) ?? "kr"
  const t = useTranslations("mypage.membership")

  const handleSubscribe = () => {
    router.push(`/${countryCode}/mypage/membership/subscribe/payment`)
  }

  const handleBenefitClick = useCallback((benefitId: string) => {
    const element = document.getElementById(benefitId)
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [])

  return (
    <div className="overflow-hidden rounded-2xl bg-zinc-900">
      <div className="px-4 pb-8 md:px-6">
        <section className="relative flex flex-col items-center overflow-hidden rounded-xl py-12 text-center">
          <Image
            src="/images/membership-hero-bg.webp"
            alt=""
            fill
            className="object-cover object-top"
            priority
          />
          <div className="absolute inset-0 bg-linear-to-b from-transparent via-zinc-900/50 to-zinc-900" />
          <div className="relative z-10 flex flex-col items-center pt-40 pb-10">
            <div className="mb-6">
              <Image
                src="/images/logo.webp"
                alt={t("logoAlt")}
                width={120}
                height={80}
              />
            </div>
            <h1 className="mb-1 text-xl font-bold text-white md:text-2xl">
              {t("history.heroTitle")}
            </h1>
            <h2 className="mb-6 text-2xl font-bold text-white md:text-3xl">
              {t("history.heroGrandOpen")}
            </h2>
            {showSubscribeCta && (
              <CustomButton
                onClick={handleSubscribe}
                className="mb-4 h-12 w-full max-w-sm cursor-pointer rounded-lg bg-primary text-base font-semibold text-white hover:bg-[#e14d00]"
              >
                {t("history.subscribe")}
              </CustomButton>
            )}
            <div className="space-y-1 text-left text-xs text-white/50">
              <p>{t("history.priceNoticeMonthlyYearly")}</p>
              <p>{t("history.priceNoticeFreeMonths")}</p>
            </div>
          </div>
        </section>

        <Separator className="bg-white/20" />
        <BenefitOverviewSection onBenefitClick={handleBenefitClick} />
        <Separator className="bg-white/20" />
        <BenefitDetailSection />
        <Separator className="bg-white/20" />
        <UpcomingBenefitsSection />
        <Separator className="bg-white/20" />
        <MembershipFAQSection />
      </div>
    </div>
  )
}
