import SubscriberSection from "../components/subscriber/subscriber-section"
import NonSubscriberSection from "../components/non-subscriber"
import MembershipInvoicesSection from "../components/subscriber/membership-invoices-section"
import type {
  CancellationPreviewDto,
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
  cancellationPreview: CancellationPreviewDto | null
  currentBenefit: CycleBenefitDto | null
  benefitHistory: CycleBenefitHistoryDto | null
  hasCafe24Link: boolean
}

export default function MembershipTemplate({
  isMember,
  membershipData,
  plans,
  currentSavings,
  rangeSavings,
  subscriptionHistory,
  cancellationReasons,
  cancellationPreview,
  currentBenefit,
  benefitHistory,
  hasCafe24Link,
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
          cancellationPreview={cancellationPreview}
          currentBenefit={currentBenefit}
          benefitHistory={benefitHistory}
          hasCafe24Link={hasCafe24Link}
        />
      ) : (
        <>
          {/* 자격을 잃은 뒤에도 청구 내역은 보여준다. 계좌 심사 거절(MANDATE_REJECTED)·미수로 멤버십이
              끊긴 고객에게 이걸 숨기면, 화면에는 "가입하기" 만 남아 왜 끊겼는지 알 방법이 없다.
              (인보이스는 사용자 단위라 계약이 해지돼도 조회된다. 없으면 스스로 숨는다.) */}
          <MembershipInvoicesSection />
          <NonSubscriberSection
            hasHistory={subscriptionHistory.length > 0}
            hasCafe24Link={hasCafe24Link}
          />
        </>
      )}
    </div>
  )
}
