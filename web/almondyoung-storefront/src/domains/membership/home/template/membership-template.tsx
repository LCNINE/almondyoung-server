import { PageTitle } from "@/components/shared/page-title"
import SubscriberSection from "../components/subscriber/subscriber-section"
import NonSubscriberSection from "../components/non-subscriber"
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
interface MembershipTemplateProps {
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

export default function MembershipTemplate({
  isMember,
  membershipData,
  plans,
  currentSavings,
  rangeSavings,
  subscriptionHistory,
  cancellationReasons,
  currentBenefit,
  benefitHistory,
}: MembershipTemplateProps) {
  return (
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
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
        <NonSubscriberSection />
      )}
    </div>
  )
}
