import { MembershipForm } from "./components"
import type { PlanWithTier } from "@lib/types/membership"

import { WithHeaderLayout } from "@components/layout/with-header-layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { getCurrentSubscription, getPlans } from "@lib/api/membership"

async function getPlansData(): Promise<PlanWithTier[]> {
  return getPlans()
}

export default async function MembershipFormPage() {
  let plans: PlanWithTier[] = []
  let plansError = false

  const [plansResult, currentSubscription] = await Promise.all([
    getPlansData().catch((error) => {
      plansError = true
      console.error("❌ Plans API error:", error)
      return []
    }),
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
          existingSubType={
            currentSubscription?.plan?.durationDays === 30
              ? "monthly"
              : currentSubscription?.plan?.durationDays === 365
                ? "yearly"
                : null
          }
          availableBenefits={[]}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
