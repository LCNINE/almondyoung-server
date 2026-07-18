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
}: MemberDetailsProps) {
  const t = useTranslations("mypage.membership")

  const fmt = (d?: string | null) => formatDate(d, DATE_FORMATS.KO_LONG)

  const today = new Date()
  const billingDate = membershipData?.billingDate
    ? new Date(membershipData.billingDate)
    : null
  const isInTrial = !!billingDate && billingDate > today
  const trialDaysRemaining = isInTrial
    ? differenceInCalendarDays(billingDate, today)
    : 0

  // 정기결제는 다음 결제일이 있고, 1회결제는 없음(null) → 이용 종료일만 존재
  const recurringNextBillingDate = membershipData?.nextBillingDate ?? null
  const isRecurring = isInTrial || !!recurringNextBillingDate
  const membershipEndDate =
    membershipData?.currentPeriodEnd ?? membershipData?.endDate ?? null

  const tierCode =
    membershipData?.tier?.code ?? membershipData?.plan?.tier?.code ?? "-"
  const tierName =
    membershipData?.tier?.name ??
    membershipData?.plan?.tier?.name ??
    t("defaultTierName")

  const savingsTotal = currentSavings?.totalSavings ?? 0

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {membershipData?.paymentActionNeeded && (
        <p className="w-full rounded-md bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
          {t("billing.paymentActionNeeded")}
        </p>
      )}
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
      ) : membershipData?.autoRenewal === false ? (
        // 정기해지/일시결제 — "다음 결제 예정일"이 아니라 이용 종료일을 안내
        <figcaption className="text-center font-['Pretendard'] text-sm font-normal text-black">
          {t.rich("billing.membershipEndsNotice", {
            date: fmt(membershipEndDate),
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
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

      {/* 3. 이번달 절약 금액 히어로  */}
      <article className="flex w-full flex-col justify-center gap-1.5 rounded-2xl bg-white py-6">
        <h3 className="text-muted-foreground text-center text-sm font-medium">
          {t("stats.monthlySavings")}
        </h3>
        <div className="flex items-end justify-center gap-1">
          <span className="text-primary text-3xl font-bold">
            {savingsTotal.toLocaleString()}
          </span>
          <span className="text-muted-foreground pb-1 text-sm">
            {t("stats.unitWon")}
          </span>
        </div>
      </article>
    </div>
  )
}
