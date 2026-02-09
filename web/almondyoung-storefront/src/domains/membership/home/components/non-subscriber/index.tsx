"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import { Separator } from "@/components/ui/separator"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useCallback } from "react"
import BenefitDetailSection from "./benefit-detail-section"
import BenefitOverviewSection from "./benefit-overview-section"
import MembershipFAQSection from "./membership-faq-section"
import UpcomingBenefitsSection from "./upcoming-benefits-section"

/**
 * 멤버십 미가입자 전용 섹션
 *
 * 미가입자에게만 보여지는 UI:
 * - 멤버십 혜택 안내
 * - 멤버십 신청 버튼
 */
export default function NonSubscriberSection() {
  const router = useRouter()

  const handleBenefitClick = useCallback((benefitId: string) => {
    const element = document.getElementById(benefitId)
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [])

  const handleSubscribe = () => {
    router.push("/kr/mypage/membership/subscribe/payment")
  }

  return (
    <div className="mt-8 rounded-2xl bg-zinc-900 px-4 py-8 md:px-6">
      {/* 헤더 섹션 */}
      <section className="relative flex flex-col items-center overflow-hidden rounded-xl py-12 text-center">
        {/* 배경 이미지 */}
        <Image
          src="/images/membership-hero-bg.webp"
          alt=""
          fill
          className="object-cover object-top"
          priority
        />
        {/* 오버레이 */}
        <div className="absolute inset-0 bg-linear-to-b from-transparent via-zinc-900/50 to-zinc-900" />

        {/* 콘텐츠 */}
        <div className="relative z-10 flex flex-col items-center pt-40 pb-10">
          {/* 로고 아이콘 */}
          <div className="mb-6">
            <Image
              src="/images/logo.webp"
              alt="아몬드영 로고"
              width={120}
              height={80}
            />
          </div>

          <h1 className="mb-1 text-xl font-bold text-white md:text-2xl">
            아몬드영 멤버십 서비스
          </h1>
          <h2 className="mb-6 text-2xl font-bold text-white md:text-3xl">
            GRAND OPEN
          </h2>

          <p className="mb-6 text-sm text-white/60">
            구독을 시작하려면 로그인을 해주세요.
          </p>

          <CustomButton
            onClick={handleSubscribe}
            className="mb-4 h-12 w-full max-w-sm cursor-pointer rounded-lg bg-[#f29219] text-base font-semibold text-white hover:bg-[#d98317]"
          >
            구독하기
          </CustomButton>

          <div className="space-y-1 text-left text-xs text-white/50">
            <p>
              <span className="text-red-400">* </span>유료 멤버십 월 4,990원 /
              연 49,900원
            </p>
            <p>
              <span className="text-red-400">* </span>연간 구독 시 2개월 무료
              사용
            </p>
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
  )
}
