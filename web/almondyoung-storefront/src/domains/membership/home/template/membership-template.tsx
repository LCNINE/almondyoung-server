import SubscriberSection from "../components/subscriber/subscriber-section"
import NonSubscriberSection from "../components/non-subscriber"
import MembershipInvoicesSection from "../components/subscriber/membership-invoices-section"
import RefundStatusCard from "../components/refund-status-card"
import TerminationNoticeCard from "../components/termination-notice-card"
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
interface MembershipTemplateProps {
  isMember: boolean
  membershipData: SubscriptionDetailsDto | null
  plans: PlanWithTier[]
  /** 결제 주기별 절약액. 환불 판정과 같은 기간 경계를 쓴다. */
  savingsOverview: SavingsOverviewDto | null
  subscriptionHistory: SubscriptionHistoryItemDto[]
  cancellationReasons: CancellationReasonDto[]
  cancellationPreview: CancellationPreviewDto | null
  hasCafe24Link: boolean
  /** 진행 중이거나 최근 완료된 환불. 해지 뒤에도 고객이 확인할 수 있어야 한다. */
  refundStatus: RefundStatusDto | null
  /** 멤버십이 왜 끝났는지(계좌 심사 거절·미수 등). 활성 자격이 있으면 null. */
  terminationNotice: TerminationNoticeDto | null
}

export default function MembershipTemplate({
  isMember,
  membershipData,
  plans,
  savingsOverview,
  subscriptionHistory,
  cancellationReasons,
  cancellationPreview,
  hasCafe24Link,
  refundStatus,
  terminationNotice,
}: MembershipTemplateProps) {
  return (
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      {/* 해지 직후 토스트를 놓쳐도 얼마가 언제 들어오는지 다시 확인할 수 있어야 한다.
          즉시해지하면 아래가 비가입자 화면으로 바뀌므로 가입 여부와 무관하게 맨 위에 둔다. */}
      {/* 왜 끝났는지 먼저 알린다 — 화면에 '가입하기' 만 남으면 고객은 이유를 알 수 없다. */}
      {terminationNotice && <TerminationNoticeCard notice={terminationNotice} />}
      {refundStatus && <RefundStatusCard refundStatus={refundStatus} />}
      {isMember ? (
        <SubscriberSection
          membershipData={membershipData}
          plans={plans}
          savingsOverview={savingsOverview}
          subscriptionHistory={subscriptionHistory}
          cancellationReasons={cancellationReasons}
          cancellationPreview={cancellationPreview}
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
