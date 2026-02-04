import { MembershipForm } from "./components"
import type { PlanWithTier } from "@lib/types/membership"

import { HttpApiError } from "@lib/api/api-error"
import { WithHeaderLayout } from "@components/layout/with-header-layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { getCurrentSubscription, getPlans } from "@lib/api/membership"

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

async function getPlansData(): Promise<PlanWithTier[]> {
  return getPlans()
}

async function getPaymentProfiles() {
  try {
    const { getBnplProfiles } = await import("@lib/api/wallet")

    const profiles = await getBnplProfiles()
    console.log("✅ Payment profiles loaded:", profiles)
    return profiles
  } catch (error) {
    // 에러 상세 정보 로깅
    console.error("❌ Payment profiles API error:", {
      message: error instanceof Error ? error.message : "Unknown error",
      status: error instanceof HttpApiError ? error.status : undefined,
    })
    // 프로필이 없거나 에러 발생 시 빈 배열 반환
    return []
  }
}

export default async function MembershipFormPage() {
  let plans: PlanWithTier[] = []
  let plansError = false

  const [plansResult, paymentProfiles, currentSubscription] =
    await Promise.all([
      getPlansData().catch((error) => {
        plansError = true
        console.error("❌ Plans API error:", error)
        return []
      }),
      getPaymentProfiles(),
      getCurrentSubscription().catch(() => null),
    ])

  plans = plansResult

  // 월간/연간 플랜 추출 (durationDays로 판별)
  const monthlyPlan = plans.find((p) => p.plan.durationDays === 30)
  const yearlyPlan = plans.find((p) => p.plan.durationDays === 365)

  if (plansError || !monthlyPlan || !yearlyPlan) {
    return (
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: "멤버십 구독",
        }}
      >
        <MypageLayout>
          <section className="rounded-lg border border-gray-200 bg-white p-6 text-center">
            <h2 className="text-lg font-semibold text-gray-900">
              멤버십 플랜 정보를 불러오지 못했습니다.
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              잠시 후 다시 시도해주세요.
            </p>
          </section>
        </MypageLayout>
      </WithHeaderLayout>
    )
  }

  // HMS 카드 프로필 찾기
  const hmsCardProfile = paymentProfiles?.find(
    (p: any) => p.kind === "CARD" && p.provider === "HMS_CARD"
  )

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "멤버십 구독",
      }}
    >
      <MypageLayout>
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
          existingSubType={
            currentSubscription?.plan?.durationDays === 30
              ? "monthly"
              : currentSubscription?.plan?.durationDays === 365
                ? "yearly"
                : null
          }
          availableBenefits={mockBenefits}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
