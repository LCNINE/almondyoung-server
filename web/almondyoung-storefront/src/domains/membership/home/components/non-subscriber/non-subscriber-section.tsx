"use client"

import { useRouter } from "next/navigation"
import MembershipPlanCard from "../membership-benefit-card"
import { CustomButton } from "@/components/shared/custom-buttons"
import NonSubscriberBanner from "./non-subcriber-banner"
import MembershipStatusSection from "domains/membership/components/status-selection"
import MembershipPromoBanner from "./membership-promo-banner"
import type { PlanWithTier } from "@lib/types/membership"

/**
 * 멤버십 미가입자 전용 섹션
 *
 * 미가입자에게만 보여지는 UI:
 * - 멤버십 혜택 안내
 * - 멤버십 신청 버튼
 */
interface NonSubscriberSectionProps {
  plans: PlanWithTier[]
}

const getMonthlyPrice = (plan: PlanWithTier) =>
  Math.round(plan.plan.price / Math.max(1, plan.plan.durationDays / 30))

export default function NonSubscriberSection({ plans }: NonSubscriberSectionProps) {
  const router = useRouter()
  const monthlyPlan = plans.find((plan) => plan.plan.durationDays === 30)
  const yearlyPlan = plans.find((plan) => plan.plan.durationDays === 365)
  const yearlyMonthlyPrice = yearlyPlan ? getMonthlyPrice(yearlyPlan) : null
  const discountRate =
    yearlyPlan && monthlyPlan
      ? Math.max(
          0,
          Math.round(
            (1 - yearlyPlan.plan.price / (monthlyPlan.plan.price * 12)) * 100
          )
        )
      : null

  return (
    <>
      {/* 비회원 - 혜택 안내 */}
      <NonSubscriberBanner />
      <MembershipStatusSection>
        <MembershipPromoBanner />
      </MembershipStatusSection>
      <section className="mb-[36px]">
        <h3 className="my-4 hidden text-center text-lg font-semibold text-black md:block">
          멤버십 혜택
        </h3>
        <MembershipPlanCard
          planName={yearlyPlan?.tier?.name ?? "연간"}
          price={yearlyPlan?.plan.price ?? 0}
          period={
            yearlyPlan
              ? `${Math.round(yearlyPlan.plan.durationDays / 30)}개월(연간구독)`
              : "12개월(연간구독)"
          }
          monthlyPrice={
            yearlyMonthlyPrice != null
              ? `${yearlyMonthlyPrice.toLocaleString()}원`
              : "-"
          }
          discountRate={
            discountRate != null ? `약 ${discountRate}% 절감` : "혜택 안내"
          }
          benefitText="첫달 무료 + 사용하지 않는 기간 일시정지 가능"
          variant="annual"
        />
      </section>

      {/* 가입 버튼 */}
      <CustomButton
        variant="fill"
        color="primary"
        size="lg"
        fullWidth={true}
        onClick={() => router.push("/kr/mypage/membership/subscribe/payment")}
      >
        아몬드영 멤버십 신청하기
      </CustomButton>
    </>
  )
}
