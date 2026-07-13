"use client"

import React from "react"
import { differenceInCalendarDays } from "date-fns"
import { useTranslations } from "next-intl"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import type {
  CycleBenefitDto,
  SubscriptionDetailsDto,
} from "@lib/types/dto/membership"
import type { MonthlySavingsDto } from "@lib/types/dto/membership-savings"

interface MemberDetailsProps {
  membershipData: SubscriptionDetailsDto | null
  currentSavings: MonthlySavingsDto | null
  currentBenefit: CycleBenefitDto | null
}

export default function MemberDetails({
  membershipData,
  currentSavings,
  currentBenefit,
}: MemberDetailsProps) {
  const t = useTranslations("mypage.membership")

  function StatCard({
    label,
    value,
    unit,
  }: {
    label: string
    value: string
    unit: string
  }) {
    return (
      <article className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-muted py-4">
        <h3 className="text-muted-foreground text-center text-xs font-normal">
          {label}
        </h3>
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-foreground text-lg font-bold">{value}</span>
          <span className="text-muted-foreground text-xs leading-4">{unit}</span>
        </div>
      </article>
    )
  }

  const fmt = (d?: string | null) => formatDate(d, DATE_FORMATS.KO_LONG)

  const today = new Date()
  const billingDate = membershipData?.billingDate ? new Date(membershipData.billingDate) : null
  const isInTrial = !!billingDate && billingDate > today
  const trialDaysRemaining = isInTrial ? differenceInCalendarDays(billingDate, today) : 0

  // 정기결제는 다음 결제일이 있고, 1회결제는 없음(null) → 이용 종료일만 존재
  const recurringNextBillingDate = membershipData?.nextBillingDate ?? null
  const isRecurring = isInTrial || !!recurringNextBillingDate
  const membershipEndDate =
    membershipData?.currentPeriodEnd ?? membershipData?.endDate ?? null

  const tierCode =
    membershipData?.tier?.code ?? membershipData?.plan?.tier?.code ?? "-"
  const tierName =
    membershipData?.tier?.name ?? membershipData?.plan?.tier?.name ?? t("defaultTierName")

  const savingsTotal = currentSavings?.totalSavings ?? 0
  const savingsOrders = currentSavings?.orderCount ?? 0
  const cycleSavingsTotal = currentBenefit?.totalDiscountAmount ?? 0
  const cycleOrders = currentBenefit?.orderCount ?? 0
  const daysRemaining = currentBenefit?.daysRemaining

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {/* 1. 계정 상태 및 플랜 관리 */}
      {isInTrial ? (
        <figcaption className="flex flex-col items-center gap-1.5 font-['Pretendard']">
          <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold">
            {t("subscription.freeTrialRemaining", { days: trialDaysRemaining })}
          </span>
          <p className="text-center text-sm text-gray-600">
            {t("billing.trialEndAutoStartLabel")}:{" "}
            <strong className="text-black">
              {fmt(membershipData?.billingDate)}
            </strong>
          </p>
        </figcaption>
      ) : isRecurring ? (
        <figcaption className="text-center font-['Pretendard'] text-sm font-normal text-black">
          {t.rich("billing.nextBillingNotice", {
            date: fmt(recurringNextBillingDate),
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </figcaption>
      ) : (
        <figcaption className="text-center font-['Pretendard'] text-sm font-normal text-black">
          {t("billing.membershipEndNotice", { date: fmt(membershipEndDate) })}
        </figcaption>
      )}
      <div className="flex items-center gap-1.5">
        <span className="bg-primary/10 text-primary rounded-md px-2 py-1 text-xs font-bold">
          {tierName}
        </span>
        <span className="bg-secondary text-muted-foreground rounded-md px-2 py-1 text-xs font-bold">
          {tierCode}
        </span>
      </div>

      {/* 2. 구분선 */}
      <hr className="w-full border-t border-gray-200" />

      {/* 3. 통계 대시보드 (이제 이 컴포넌트의 일부) */}
      <article className="flex w-full flex-col justify-center gap-2 rounded-xl border border-border bg-white py-6">
        <h3 className="text-muted-foreground text-center text-sm font-normal">
          {t("stats.monthlySavings")}
        </h3>
        <div className="flex items-end justify-center gap-1">
          <span className="text-primary text-2xl font-bold">
            {savingsTotal.toLocaleString()}
          </span>
          <span className="text-muted-foreground text-xs leading-5">
            {t("stats.unitWon")}
          </span>
        </div>
      </article>

      <div className="flex w-full flex-col items-stretch gap-4 md:flex-row md:flex-wrap">
        <StatCard
          label={t("stats.monthlyOrders")}
          value={savingsOrders.toLocaleString()}
          unit={t("stats.unitCount")}
        />
        <StatCard
          label={t("stats.cycleSavings")}
          value={cycleSavingsTotal.toLocaleString()}
          unit={t("stats.unitWon")}
        />
        <StatCard
          label={t("stats.cycleOrders")}
          value={cycleOrders.toLocaleString()}
          unit={t("stats.unitCount")}
        />
        <StatCard
          label={t("stats.cycleRemaining")}
          value={daysRemaining != null ? daysRemaining.toLocaleString() : "-"}
          unit={t("stats.unitDay")}
        />
      </div>
    </div>
  )
}
