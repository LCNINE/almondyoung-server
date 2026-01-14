"use client"

import { useRouter } from "next/navigation"
import MembershipPlanCard from "../membership-benefit-card"
import { CustomButton } from "@/components/shared/custom-buttons"
import NonSubscriberBanner from "./non-subcriber-banner"
import MembershipStatusSection from "domains/membership/components/status-selection"
import MembershipPromoBanner from "./membership-promo-banner"

/**
 * 멤버십 미가입자 전용 섹션
 *
 * 미가입자에게만 보여지는 UI:
 * - 멤버십 혜택 안내
 * - 멤버십 신청 버튼
 */
export default function NonSubscriberSection() {
  const router = useRouter()

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
        <MembershipPlanCard />
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
