"use client"

import { useParams, useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { AlertCircle, ChevronRight } from "lucide-react"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { useTranslations } from "next-intl"
import { IconTextButton } from "../../../components/icon-button"
import { MembershipCancelModal } from "../../../components/modal"
import MembershipPlanCard from "../membership-benefit-card"
import MembershipStatusSection from "domains/membership/components/status-selection"
import MemberDetails from "./member-details"
import { cancelSubscription } from "@/lib/api/membership"
import { toast } from "sonner"
import { pollCartRefreshUntilGroupRemoved } from "../../poll-cart-refresh"
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

const LEGACY_URL =
  process.env.NEXT_PUBLIC_LEGACY_MEMBERSHIP_HISTORY_URL ??
  "https://almondyoung.com/myshop/mileage/historyList.html"

export default function SubscriberSection({
  membershipData,
  plans,
  currentSavings,
  cancellationReasons,
  currentBenefit,
  hasCafe24Link,
}: SubscriberSectionProps) {
  const [open, setOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const router = useRouter()
  const params = useParams()
  const countryCode = (params?.countryCode as string) ?? "kr"
  const t = useTranslations("mypage.membership")
  const hasCancellationReasons = useMemo(
    () => cancellationReasons.length > 0,
    [cancellationReasons]
  )
  // 이번 주기 혜택(멤버십가 구매·웰컴딜 등)을 하나도 안 썼으면 결제액 전액 환불 대상.
  // 최종 환불 여부·금액은 서버가 확정하고, 여기선 모달 문구/환불계좌 노출을 위한 예측만 한다.
  const refundEligible =
    !currentBenefit ||
    (currentBenefit.orderCount === 0 && currentBenefit.totalDiscountAmount === 0)

  const buildPlanBenefits = (plan?: PlanWithTier) => {
    if (!plan) return []
    const benefits = []
    if (plan.plan.trialDays > 0) {
      benefits.push({
        id: `${plan.plan.id}-trial`,
        title: t("subscription.freeTrialTitle", { days: plan.plan.trialDays }),
      })
    }
    return benefits
  }

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
          label={t("billing.paymentMethod")}
          size="full"
          onClick={() => router.push(`/${countryCode}/mypage/membership/payment-method`)}
        />
      </section>
      <MembershipPlanCard
        planName={yearlyPlan?.tier?.name ?? t("benefits.planNameDefault")}
        price={yearlyPlan?.plan.price ?? 0}
        period={
          yearlyPlan
            ? t("subscription.annualLongWithMonths", { months: Math.round(yearlyPlan.plan.durationDays / 30) })
            : t("subscription.annualLong")
        }
        monthlyPrice={
          yearlyMonthlyPrice != null
            ? t("billing.amountWon", { amount: yearlyMonthlyPrice.toLocaleString() })
            : "-"
        }
        discountRate={discountRate != null ? t("subscription.savingsRate", { discountRate }) : "-"}
        benefitText={
          yearlyPlan?.plan.trialDays
            ? t("subscription.freeTrialTitle", { days: yearlyPlan.plan.trialDays })
            : undefined
        }
        benefits={buildPlanBenefits(yearlyPlan)}
        variant="annual"
      />
      {/* 하단 액션 그룹 */}
      <div className="mt-6 flex flex-col gap-2">
        {/* 구독 이력(별도 라우트, 페이지네이션) */}
        <LocalizedClientLink
          href="/mypage/membership/history"
          className="text-foreground hover:bg-muted flex items-center justify-between rounded-lg border border-border bg-white px-4 py-3.5 text-sm font-medium transition-colors"
        >
          <span>{t("history.subscriptionHistory")}</span>
          <ChevronRight className="text-muted-foreground h-4 w-4" />
        </LocalizedClientLink>
        {/* 오독 혜택 안내(별도 라우트) */}
        <LocalizedClientLink
          href="/mypage/membership/benefits"
          className="text-foreground hover:bg-muted flex items-center justify-between rounded-lg border border-border bg-white px-4 py-3.5 text-sm font-medium transition-colors"
        >
          <span>{t("history.viewBenefitsGuide")}</span>
          <ChevronRight className="text-muted-foreground h-4 w-4" />
        </LocalizedClientLink>
        {/* 기존 아몬드영 멤버십 내역 (Cafe24 연동 고객 전용) */}
        {hasCafe24Link && (
          <a
            href={LEGACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:bg-muted flex items-center justify-between rounded-lg border border-border bg-white px-4 py-3.5 text-sm font-medium transition-colors"
          >
            <span>{t("history.legacyHistory")}</span>
            <ChevronRight className="text-muted-foreground h-4 w-4" />
          </a>
        )}
        {/* 해지 버튼 — 왼쪽 정렬 + 경고 문구 */}
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-foreground hover:bg-muted shrink-0 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-medium transition-colors"
          >
            {t("history.cancelMembership")}
          </button>
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {t("history.cancelWarning")}
          </p>
        </div>
      </div>
      <MembershipCancelModal
        open={open}
        setOpen={setOpen}
        reasons={hasCancellationReasons ? cancellationReasons : []}
        isSubmitting={isCancelling}
        refundEligible={refundEligible}
        onConfirm={async ({ reasonCode, reasonText, refundReceiveAccount }) => {
          try {
            setIsCancelling(true)
            await cancelSubscription(reasonCode, reasonText, refundReceiveAccount)
            setOpen(false)
            router.push(`/${countryCode}/mypage/membership`)
            pollCartRefreshUntilGroupRemoved(() => {
              toast.success(t("billing.cartPriceUpdated"))
              router.refresh()
            })
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
