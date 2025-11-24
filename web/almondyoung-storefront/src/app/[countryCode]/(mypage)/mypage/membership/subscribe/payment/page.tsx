import { MembershipForm } from "./components"
import type { PlanWithTier } from "@lib/types/membership"
import { serverApi } from "@lib/api/server-api"
import { ApiError } from "@lib/api/api-error"

const mockBenefits = [
  {
    id: "trial-1",
    type: "trial" as const,
    title: "신규 가입 무료 체험",
    days: 7,
    used: false,
    isSuspended: false,
  },
  {
    id: "discount-1",
    type: "discount" as const,
    title: "첫 구독 할인",
    percentage: 20,
    maxUses: 3,
    usedPayments: [],
    isSuspended: false,
  },
]

async function getPlans(): Promise<PlanWithTier[]> {
  // serverApi는 기본적으로 body.data를 추출해서 반환
  const plans = await serverApi<PlanWithTier[]>(
    `${process.env.BACKEND_URL}/membership/plans`
  )
  return plans
}

async function getPaymentProfiles() {
  try {
    const profiles = await serverApi<any[]>(
      `${process.env.BACKEND_URL}/wallet/payments/profiles`
    )
    console.log("✅ Payment profiles loaded:", profiles)
    return profiles
  } catch (error) {
    // 에러 상세 정보 로깅
    console.error("❌ Payment profiles API error:", {
      message: error instanceof Error ? error.message : "Unknown error",
      status: error instanceof ApiError ? error.status : undefined,
      url: `${process.env.BACKEND_URL}/wallet/payments/profiles`,
    })
    // 프로필이 없거나 에러 발생 시 빈 배열 반환
    return []
  }
}

export default async function MembershipFormPage() {
  const plans = await getPlans()
  const paymentProfiles = await getPaymentProfiles()

  // 월간/연간 플랜 추출 (durationDays로 판별)
  const monthlyPlan = plans.find((p) => p.plan.durationDays === 30)
  const yearlyPlan = plans.find((p) => p.plan.durationDays === 365)

  if (!monthlyPlan || !yearlyPlan) {
    throw new Error("필요한 플랜을 찾을 수 없습니다")
  }

  // HMS 카드 프로필 찾기
  const hmsCardProfile = paymentProfiles.find(
    (p) => p.kind === "CARD" && p.provider === "HMS_CARD"
  )

  return (
    <>
      <MembershipForm
        monthlyPlan={monthlyPlan}
        yearlyPlan={yearlyPlan}
        existingFmsMember={
          hmsCardProfile && hmsCardProfile.details
            ? {
                paymentCompany:
                  hmsCardProfile.details.paymentCompany || "알 수 없음",
                paymentCompanyName:
                  hmsCardProfile.details.paymentCompanyName || "알 수 없음",
                paymentNumber: hmsCardProfile.details.paymentNumber || "",
                cardLast4: hmsCardProfile.details.cardLast4 || "",
                payerName: hmsCardProfile.details.payerName || "",
              }
            : null
        }
        existingSubType={null}
        availableBenefits={mockBenefits}
      />
    </>
  )
}
