import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import MembershipTemplate from "@/domains/membership/home/template/membership-template"
import { WithHeaderLayout } from "@components/layout"
import {
  getCancellationPreview,
  getCancellationReasons,
  getCurrentCycleBenefit,
  getCurrentMonthSavings,
  getCurrentSubscription,
  getCycleBenefitHistory,
  getPlans,
  getRangeSavings,
  getRefundStatus,
  getTerminationNotice,
  getSubscriptionHistory,
} from "@lib/api/membership"
import { getCafe24LinkInfo } from "@lib/api/users/cafe24"
import { fetchMe } from "@lib/api/users/me"
import type {
  CancellationPreviewDto,
  CancellationReasonDto,
  CycleBenefitDto,
  CycleBenefitHistoryDto,
  RefundStatusDto,
  SubscriptionDetailsDto,
  TerminationNoticeDto,
  SubscriptionHistoryItemDto,
} from "@lib/types/dto/membership"
import type { PlanWithTier } from "@lib/types/membership"
import { getTranslations } from "next-intl/server"

export default async function MembershipPage() {
  const t = await getTranslations("mypage.menu")
  const [user, subscription, plans, cafe24Info] = await Promise.all([
    fetchMe().catch(() => null),
    getCurrentSubscription().catch(() => null),
    getPlans().catch(() => []),
    getCafe24LinkInfo().catch(() => null),
  ])

  const membershipData: SubscriptionDetailsDto | null = subscription ?? null
  const isMember = !!membershipData
  const hasCafe24Link = !!(
    cafe24Info &&
    "data" in cafe24Info &&
    cafe24Info.data
  )

  let currentSavings = null
  let rangeSavings = null
  let subscriptionHistory: SubscriptionHistoryItemDto[] = []
  let currentBenefit: CycleBenefitDto | null = null
  let benefitHistory: CycleBenefitHistoryDto | null = null
  let cancellationReasons: CancellationReasonDto[] = []
  // 해지 선택지·환불 금액은 서버 정책이 SoT — 클라이언트에서 추정하지 않는다.
  let cancellationPreview: CancellationPreviewDto | null = null
  // 해지 뒤에도 환불이 어디까지 왔는지 보여준다(즉시해지하면 화면이 비가입자로 바뀐다).
  let refundStatus: RefundStatusDto | null = null
  // 멤버십이 끊긴 고객에게 이유와 다음 행동을 알린다.
  let terminationNotice: TerminationNoticeDto | null = null
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
      cancellationPreviewResult,
      refundStatusResult,
      terminationNoticeResult,
    ] = await Promise.all([
      getCurrentMonthSavings().catch(() => null),
      getRangeSavings(toDateString(startDate), toDateString(now)).catch(
        () => null
      ),
      getSubscriptionHistory().catch(() => []),
      getCancellationReasons().catch(() => []),
      getCurrentCycleBenefit(user.id).catch(() => null),
      getCycleBenefitHistory(user.id, 6).catch(() => null),
      getCancellationPreview().catch(() => null),
      getRefundStatus().catch(() => null),
      getTerminationNotice().catch(() => null),
    ])

    currentSavings = currentSavingsResult
    rangeSavings = rangeSavingsResult
    subscriptionHistory = subscriptionHistoryResult
    cancellationReasons = cancellationReasonsResult
    currentBenefit = currentBenefitResult
    benefitHistory = benefitHistoryResult
    cancellationPreview = cancellationPreviewResult
    refundStatus = refundStatusResult
    terminationNotice = terminationNoticeResult
  }

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("membership"),
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
          cancellationPreview={cancellationPreview}
          currentBenefit={currentBenefit}
          benefitHistory={benefitHistory}
          hasCafe24Link={hasCafe24Link}
          refundStatus={refundStatus}
          terminationNotice={terminationNotice}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
