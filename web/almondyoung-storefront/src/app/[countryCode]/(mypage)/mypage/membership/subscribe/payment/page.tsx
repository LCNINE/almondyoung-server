import { getTranslations } from "next-intl/server"
import { MembershipForm } from "./components"
import type { PlanWithTier } from "@lib/types/membership"

import { WithHeaderLayout } from "@components/layout/with-header-layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  getCurrentSubscription,
  getMyArrears,
  getPlans,
} from "@lib/api/membership"

async function getPlansData(): Promise<PlanWithTier[]> {
  return getPlans()
}

export default async function MembershipFormPage() {
  const t = await getTranslations("mypage.membershipSubscribe")
  let plans: PlanWithTier[] = []
  let plansError = false

  const [plansResult, currentSubscription, arrears] = await Promise.all([
    getPlansData().catch((error) => {
      plansError = true
      console.error("❌ Plans API error:", error)
      return []
    }),
    getCurrentSubscription().catch(() => null),
    // 미납이 있으면 서버가 가입을 거절한다. 폼을 채우고(자동이체 계좌 등록까지 하고) 나서 거절당하지
    // 않도록 들어오는 순간 알린다. 조회가 실패하면 0 으로 접히므로 최종 판정은 서버의 409 다.
    getMyArrears(),
  ])

  plans = plansResult

  // 월간/연간 플랜 추출 (durationDays로 판별)
  const monthlyPlan = plans.find((p) => p.plan.durationDays === 30)
  const yearlyPlan = plans.find((p) => p.plan.durationDays === 365)

  const existingSubType =
    currentSubscription?.plan?.durationDays === 30
      ? ("monthly" as const)
      : currentSubscription?.plan?.durationDays === 365
        ? ("yearly" as const)
        : null

  if (arrears.outstanding.total > 0) {
    return (
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: t("pageTitle"),
        }}
      >
        <MypageLayout>
          <section
            data-testid="membership-arrears-first"
            className="rounded-lg border border-gray-200 bg-white p-6 text-center"
          >
            <h2 className="text-lg font-semibold text-gray-900">
              {t("arrearsFirstTitle")}
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              {t("arrearsFirstDescription", {
                amount: arrears.outstanding.total.toLocaleString(),
              })}
            </p>
            {/* 상세와 납부 버튼은 멤버십 페이지의 미수 섹션 한 곳에만 둔다. */}
            <LocalizedClientLink
              href="/mypage/membership"
              className="bg-primary text-primary-foreground mt-5 inline-flex h-12 items-center justify-center rounded-xl px-6 text-sm font-bold"
            >
              {t("arrearsFirstCta")}
            </LocalizedClientLink>
          </section>
        </MypageLayout>
      </WithHeaderLayout>
    )
  }

  if (plansError || !monthlyPlan || !yearlyPlan) {
    return (
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: t("pageTitle"),
        }}
      >
        <MypageLayout>
          <section className="rounded-lg border border-gray-200 bg-white p-6 text-center">
            <h2 className="text-lg font-semibold text-gray-900">
              {t("plansLoadFailTitle")}
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              {t("plansLoadFailDescription")}
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
        mobileSubBackHeaderTitle: t("pageTitle"),
      }}
    >
      <MypageLayout>
        <MembershipForm
          monthlyPlan={monthlyPlan}
          yearlyPlan={yearlyPlan}
          existingSubType={existingSubType}
          availableBenefits={[]}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
