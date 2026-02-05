"use client"

import { PageTitle } from "@/components/shared/page-title"
import SubscriberSection from "./components/subscriber/subscriber-section"
import NonSubscriberSection from "./components/non-subscriber/non-subscriber-section"
import type {
  CancellationReasonDto,
  CycleBenefitDto,
  CycleBenefitHistoryDto,
  SubscriptionDetailsDto,
  SubscriptionHistoryItemDto,
} from "@lib/types/dto/membership"
import type {
  MonthlySavingsDto,
  RangeSavingsDto,
} from "@lib/types/dto/membership-savings"
import type { PlanWithTier } from "@lib/types/membership"
interface MembershipPageClientProps {
  isMember: boolean
  membershipData: SubscriptionDetailsDto | null
  plans: PlanWithTier[]
  currentSavings: MonthlySavingsDto | null
  rangeSavings: RangeSavingsDto | null
  subscriptionHistory: SubscriptionHistoryItemDto[]
  cancellationReasons: CancellationReasonDto[]
  currentBenefit: CycleBenefitDto | null
  benefitHistory: CycleBenefitHistoryDto | null
}

/**
 * 멤버십 관리 페이지 클라이언트 컴포넌트
 *
 * 서버에서 전달받은 멤버십 상태에 따라 다른 UI를 렌더링
 */
export default function MembershipPageClient({
  isMember,
  membershipData,
  plans,
  currentSavings,
  rangeSavings,
  subscriptionHistory,
  cancellationReasons,
  currentBenefit,
  benefitHistory,
}: MembershipPageClientProps) {
  return (
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <PageTitle>멤버십 관리</PageTitle>

      {isMember ? (
        <SubscriberSection
          membershipData={membershipData}
          plans={plans}
          currentSavings={currentSavings}
          rangeSavings={rangeSavings}
          subscriptionHistory={subscriptionHistory}
          cancellationReasons={cancellationReasons}
          currentBenefit={currentBenefit}
          benefitHistory={benefitHistory}
        />
      ) : (
        <NonSubscriberSection
          plans={plans}
          rangeSavings={rangeSavings}
          subscriptionHistory={subscriptionHistory}
          benefitHistory={benefitHistory}
        />
      )}
    </div>
  )
}
