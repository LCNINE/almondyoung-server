"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { ChevronRight } from "lucide-react"
import { IconTextButton } from "../../../components/icon-button"
import { MembershipCancelModal } from "../../../components/modal"
import MembershipPlanCard from "../membership-benefit-card"
import MembershipStatusSection from "domains/membership/components/status-selection"
import MemberDetails from "./member-details"
import { cancelSubscription } from "@/lib/api/membership"
import { refreshCartPrices } from "@/lib/api/medusa/cart"

// 해지 후 그룹이 제거될 때까지 폴링
function pollCartRefreshUntilGroupRemoved(
  intervalMs = 3_000,
  maxDurationMs = 30_000,
): void {
  const startedAt = Date.now()
  const poll = () => {
    setTimeout(async () => {
      const result = await refreshCartPrices().catch(() => null)
      // false → 그룹 제거 완료, null → 카트 없음: 둘 다 종료
      if (!result || result.hasMembershipGroup !== true) return
      if (Date.now() - startedAt < maxDurationMs) poll()
    }, intervalMs)
  }
  poll()
}
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
import MembershipHistorySection from "./subscriber-history-section"
import type { PlanWithTier } from "@lib/types/membership"

/**
 * 멤버십 가입자 전용 섹션
 *
 * 가입자에게만 보여지는 UI:
 * - 멤버십 로고 (공통)
 * - 가입자 상세 정보 (다음 결제 예정일, 통계 등)
 * - 월회비 결제수단 변경
 * - 멤버십 혜택 카드
 * - 멤버십 해지하기
 */
interface SubscriberSectionProps {
  membershipData: SubscriptionDetailsDto | null
  plans: PlanWithTier[]
  currentSavings: MonthlySavingsDto | null
  rangeSavings: RangeSavingsDto | null
  subscriptionHistory: SubscriptionHistoryItemDto[]
  cancellationReasons: CancellationReasonDto[]
  currentBenefit: CycleBenefitDto | null
  benefitHistory: CycleBenefitHistoryDto | null
  hasCafe24Link: boolean
}

const buildPlanBenefits = (plan?: PlanWithTier) => {
  if (!plan) return []
  const benefits = []
  if (plan.plan.trialDays > 0) {
    benefits.push({
      id: `${plan.plan.id}-trial`,
      title: `무료 체험 ${plan.plan.trialDays}일`,
    })
  }
  return benefits
}

const LEGACY_URL =
  process.env.NEXT_PUBLIC_LEGACY_MEMBERSHIP_HISTORY_URL ??
  "https://almondyoung.com/myshop/mileage/historyList.html"

export default function SubscriberSection({
  membershipData,
  plans,
  currentSavings,
  rangeSavings,
  subscriptionHistory,
  cancellationReasons,
  currentBenefit,
  benefitHistory,
  hasCafe24Link,
}: SubscriberSectionProps) {
  const [open, setOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const router = useRouter()
  const hasCancellationReasons = useMemo(
    () => cancellationReasons.length > 0,
    [cancellationReasons]
  )
  const monthlyPlan = plans.find((plan) => plan.plan.durationDays === 30)
  const yearlyPlan = plans.find((plan) => plan.plan.durationDays === 365)
  const yearlyMonthlyPrice = yearlyPlan
    ? Math.round(
      yearlyPlan.plan.price / Math.max(1, yearlyPlan.plan.durationDays / 30)
    )
    : null
  const discountRate =
    yearlyPlan && monthlyPlan
      ? Math.max(
        0,
        Math.round(
          (1 - yearlyPlan.plan.price / (monthlyPlan.plan.price * 12)) * 100
        )
      )
      : null

  return (
    <>
      {/* 멤버십 회원 전용 섹션 */}
      <MembershipStatusSection>
        <MemberDetails
          membershipData={membershipData}
          currentSavings={currentSavings}
          currentBenefit={currentBenefit}
        />
      </MembershipStatusSection>
      <section className="mb-6 flex flex-col gap-4">
        {/* 월회비 결제수단 변경 */}
        <IconTextButton
          label="월회비 결제수단 변경"
          size="full"
          onClick={() => router.push("/kr/mypage/membership/payment-method")}
        />
      </section>
      <MembershipPlanCard
        planName={yearlyPlan?.tier?.name ?? "연간"}
        price={yearlyPlan?.plan.price ?? 0}
        period={
          yearlyPlan
            ? `${Math.round(yearlyPlan.plan.durationDays / 30)}개월(연간구독)`
            : "12개월(연간구독)"
        }
        monthlyPrice={
          yearlyMonthlyPrice != null
            ? `${yearlyMonthlyPrice.toLocaleString()}원`
            : "-"
        }
        discountRate={discountRate != null ? `약 ${discountRate}% 절감` : "-"}
        benefitText={
          yearlyPlan?.plan.trialDays
            ? `무료 체험 ${yearlyPlan.plan.trialDays}일`
            : undefined
        }
        benefits={buildPlanBenefits(yearlyPlan)}
        variant="annual"
      />
      <MembershipHistorySection
        rangeSavings={rangeSavings}
        subscriptionHistory={subscriptionHistory}
        benefitHistory={benefitHistory}
      />
      {/* 기존 아몬드영 멤버십 내역 (Cafe24 연동 고객 전용) */}
      {hasCafe24Link && (
        <a
          href={LEGACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-2 flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <span>기존 아몬드영 멤버십 내역 확인하기</span>
          <ChevronRight className="h-4 w-4 text-gray-400" />
        </a>
      )}
      {/* 해지 버튼 */}
      <IconTextButton
        label="멤버십 해지하기"
        size="full"
        onClick={() => setOpen(true)}
      />
      <MembershipCancelModal
        open={open}
        setOpen={setOpen}
        reasons={hasCancellationReasons ? cancellationReasons : []}
        isSubmitting={isCancelling}
        onConfirm={async ({ reasonCode, reasonText }) => {
          try {
            setIsCancelling(true)
            await cancelSubscription(reasonCode, reasonText)
            setOpen(false)
            router.push("/kr/mypage/membership")
            // hasMembershipGroup === false가 될 때까지 3초 간격 폴링 (최대 30초)
            pollCartRefreshUntilGroupRemoved()
          } catch (error) {
            console.error("멤버십 해지 실패:", error)
          } finally {
            setIsCancelling(false)
          }
        }}
      />
    </>
  )
}
