import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import MembershipTemplate from "@/domains/membership/home/template/membership-template"
import { WithHeaderLayout } from "@components/layout"
import {
  getCancellationPreview,
  getCancellationReasons,
  getCurrentSubscription,
  getPlans,
  getRefundStatus,
  getSavingsOverview,
  getTerminationNotice,
  getSubscriptionHistory,
} from "@lib/api/membership"
import { getCafe24LinkInfo } from "@lib/api/users/cafe24"
import { fetchMe } from "@lib/api/users/me"
import type {
  CancellationPreviewDto,
  CancellationReasonDto,
  RefundStatusDto,
  SubscriptionDetailsDto,
  TerminationNoticeDto,
  SubscriptionHistoryItemDto,
} from "@lib/types/dto/membership"
import type { SavingsOverviewDto } from "@lib/types/dto/membership-savings"
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

  let savingsOverview: SavingsOverviewDto | null = null
  let subscriptionHistory: SubscriptionHistoryItemDto[] = []
  let cancellationReasons: CancellationReasonDto[] = []
  // 해지 선택지·환불 금액은 서버 정책이 SoT — 클라이언트에서 추정하지 않는다.
  let cancellationPreview: CancellationPreviewDto | null = null
  // 해지 뒤에도 환불이 어디까지 왔는지 보여준다(즉시해지하면 화면이 비가입자로 바뀐다).
  let refundStatus: RefundStatusDto | null = null
  // 멤버십이 끊긴 고객에게 이유와 다음 행동을 알린다.
  let terminationNotice: TerminationNoticeDto | null = null
  const membershipPlans: PlanWithTier[] = plans ?? []

  if (user?.id) {
    const [
      savingsOverviewResult,
      subscriptionHistoryResult,
      cancellationReasonsResult,
      cancellationPreviewResult,
      refundStatusResult,
      terminationNoticeResult,
    ] = await Promise.all([
      getSavingsOverview().catch(() => null),
      getSubscriptionHistory().catch(() => []),
      getCancellationReasons().catch(() => []),
      getCancellationPreview().catch(() => null),
      getRefundStatus().catch(() => null),
      getTerminationNotice().catch(() => null),
    ])

    savingsOverview = savingsOverviewResult
    subscriptionHistory = subscriptionHistoryResult
    cancellationReasons = cancellationReasonsResult
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
          savingsOverview={savingsOverview}
          subscriptionHistory={subscriptionHistory}
          cancellationReasons={cancellationReasons}
          cancellationPreview={cancellationPreview}
          hasCafe24Link={hasCafe24Link}
          refundStatus={refundStatus}
          terminationNotice={terminationNotice}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
