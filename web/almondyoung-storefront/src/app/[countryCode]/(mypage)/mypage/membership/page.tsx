import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import MembershipTemplate from "@/domains/membership/home/template/membership-template"
import { WithHeaderLayout } from "@components/layout"
import {
  getCancellationReasons,
  getCurrentCycleBenefit,
  getCurrentSubscription,
  getCycleBenefitHistory,
  getPlans,
  getSubscriptionHistory,
} from "@lib/api/membership"
import {
  getCurrentMonthSavings,
  getRangeSavings,
} from "@lib/api/membership/savings"
import { fetchMe } from "@lib/api/users/me"
import type {
  CancellationReasonDto,
  CycleBenefitDto,
  CycleBenefitHistoryDto,
  SubscriptionDetailsDto,
  SubscriptionHistoryItemDto,
} from "@lib/types/dto/membership"
import type { PlanWithTier } from "@lib/types/membership"

export default async function MembershipPage() {
  const [user, subscription, plans] = await Promise.all([
    fetchMe().catch(() => null),
    getCurrentSubscription().catch(() => null),
    getPlans().catch(() => []),
  ])

  const membershipData: SubscriptionDetailsDto | null = subscription ?? null
  const isMember = membershipData?.status === "ACTIVE"

  let currentSavings = null
  let rangeSavings = null
  let subscriptionHistory: SubscriptionHistoryItemDto[] = []
  let currentBenefit: CycleBenefitDto | null = null
  let benefitHistory: CycleBenefitHistoryDto | null = null
  let cancellationReasons: CancellationReasonDto[] = []
  const membershipPlans: PlanWithTier[] = plans ?? []

  if (user?.id) {
    const now = new Date()
    const startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const toDateString = (date: Date) => date.toISOString().slice(0, 10)

    const [
      currentSavingsResult,
      rangeSavingsResult,
      subscriptionHistoryResult,
      cancellationReasonsResult,
      currentBenefitResult,
      benefitHistoryResult,
    ] = await Promise.all([
      getCurrentMonthSavings().catch(() => null),
      getRangeSavings(toDateString(startDate), toDateString(now)).catch(
        () => null
      ),
      getSubscriptionHistory().catch(() => []),
      getCancellationReasons().catch(() => []),
      getCurrentCycleBenefit(user.id).catch(() => null),
      getCycleBenefitHistory(user.id, 6).catch(() => null),
    ])

    currentSavings = currentSavingsResult
    rangeSavings = rangeSavingsResult
    subscriptionHistory = subscriptionHistoryResult
    cancellationReasons = cancellationReasonsResult
    currentBenefit = currentBenefitResult
    benefitHistory = benefitHistoryResult
  }

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "아몬드영 멤버십",
      }}
    >
      <MypageLayout>
        <MembershipTemplate
          isMember={isMember}
          membershipData={membershipData}
          plans={membershipPlans}
          currentSavings={currentSavings}
          rangeSavings={rangeSavings}
          subscriptionHistory={subscriptionHistory}
          cancellationReasons={cancellationReasons}
          currentBenefit={currentBenefit}
          benefitHistory={benefitHistory}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
