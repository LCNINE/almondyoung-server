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
      <article className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl bg-amber-50 py-4">
        <h3 className="text-center text-xs font-normal text-gray-800">
          {label}
        </h3>
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-lg font-bold text-black">{value}</span>
          <span className="text-xs leading-4 text-gray-900">{unit}</span>
        </div>
      </article>
    )
  }

  const fmt = (d?: string | null) => formatDate(d, DATE_FORMATS.KO_LONG)

  const today = new Date()
  const billingDate = membershipData?.billingDate ? new Date(membershipData.billingDate) : null
  const isInTrial = !!billingDate && billingDate > today
  const trialDaysRemaining = isInTrial ? differenceInCalendarDays(billingDate, today) : 0

  const nextBillingDate = isInTrial
    ? membershipData?.billingDate
    : (membershipData?.nextBillingDate ??
        membershipData?.currentPeriodEnd ??
        membershipData?.endDate)

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
          <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
            {t("subscription.freeTrialRemaining", { days: trialDaysRemaining })}
          </span>
          <p className="text-center text-sm text-gray-600">
            {t("billing.trialEndAutoStartLabel")}:{" "}
            <strong className="text-black">{fmt(nextBillingDate)}</strong>
          </p>
        </figcaption>
      ) : (
        <figcaption className="text-center font-['Pretendard'] text-sm font-normal text-black">
          {t.rich("billing.nextBillingNotice", {
            date: fmt(nextBillingDate),
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </figcaption>
      )}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md bg-yellow-100 px-2 py-1">
            <span className="text-xs font-bold text-yellow-700">
              {tierName}
            </span>
          </div>
          <div className="flex h-5 items-center justify-center rounded-md bg-indigo-100 px-2">
            <span className="text-xs leading-3 font-bold text-indigo-500">
              {tierCode}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="text-xs font-medium text-amber-500 underline"
        >
          {t("stats.change")}
        </button>
      </div>

      {/* 2. 구분선 */}
      <hr className="w-full border-t border-gray-200" />

      {/* 3. 통계 대시보드 (이제 이 컴포넌트의 일부) */}
      <article className="flex w-full flex-col justify-center gap-2 rounded-xl bg-amber-50 py-6">
        <h3 className="text-center text-sm font-normal text-gray-800">
          {t("stats.monthlySavings")}
        </h3>
        <div className="flex items-end justify-center gap-1">
          <span className="text-2xl font-bold text-black">
            {savingsTotal.toLocaleString()}
          </span>
          <span className="text-xs leading-5 text-gray-900">{t("stats.unitWon")}</span>
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
