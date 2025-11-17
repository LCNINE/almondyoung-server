"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { IconTextButton } from "../../../components/icon-button"
import { MembershipCancelModal } from "../../../components/modal"
import MembershipPlanCard from "../membership-benefit-card"
import { MEMBERSHIP_SERVICE_BASE_URL } from "@lib/api/api.config"
import MembershipStatusSection from "domains/membership/components/status-selection"
import MemberDetails from "./member-details"

/**
 * 멤버십 해지 API 호출 함수
 *
 * @param reasonCode - 취소 이유 코드 (예: "TRIAL_PERIOD", "PRICE_TOO_HIGH" 등)
 * @param reasonText - 취소 이유 상세 설명 (선택사항)
 * @returns 취소 결과
 */
async function cancelMembershipSubscription(
  reasonCode: string,
  reasonText?: string
) {
  const response = await fetch(
    `${MEMBERSHIP_SERVICE_BASE_URL}/subscriptions/cancel`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        reasonCode,
        reasonText,
      }),
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      message: "멤버십 해지에 실패했습니다.",
    }))
    throw new Error(error.message || "멤버십 해지에 실패했습니다.")
  }

  return response.json()
}

/**
 * 멤버십 가입자 전용 섹션
 *
 * 가입자에게만 보여지는 UI:
 * - 멤버십 로고 (공통)
 * - 가입자 상세 정보 (다음 결제 예정일, 통계 등)
 * - 월회비 결제수단 변경
 * - 멤버십 혜택 카드
 * - 멤버십 해지하기
 */
export default function SubscriberSection() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      {/* 멤버십 회원 전용 섹션 */}
      <MembershipStatusSection>
        <MemberDetails />
      </MembershipStatusSection>
      <section className="mb-6 flex flex-col gap-4">
        {/* 월회비 결제수단 변경 */}
        <IconTextButton
          label="월회비 결제수단 변경"
          size="full"
          onClick={() => router.push("/kr/mypage/membership/payment-method")}
        />
      </section>
      <MembershipPlanCard />
      {/* 해지 버튼 */}
      <IconTextButton
        label="멤버십 해지하기"
        size="full"
        onClick={async () => {
          try {
            await cancelMembershipSubscription("PRICE_TOO_HIGH")
            setOpen(false)
            router.push("/kr/mypage/membership")
          } catch (error) {
            console.error("멤버십 해지 실패:", error)
          }
        }}
      />
      <MembershipCancelModal open={open} setOpen={setOpen} />
    </>
  )
}
