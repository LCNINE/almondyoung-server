"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { useTranslations } from "next-intl"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import type { RangeSavingsDto } from "@lib/types/dto/membership-savings"
import type {
  CycleBenefitHistoryDto,
  SubscriptionAdjustmentDto,
  SubscriptionHistoryItemDto,
} from "@lib/types/dto/membership"

interface MembershipHistorySectionProps {
  rangeSavings: RangeSavingsDto | null
  subscriptionHistory: SubscriptionHistoryItemDto[]
  benefitHistory: CycleBenefitHistoryDto | null
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "text-green-600 bg-green-50",
  PAUSED: "text-yellow-600 bg-yellow-50",
  RECURRING_CANCELLED: "text-orange-500 bg-orange-50",
  CANCELLED: "text-red-500 bg-red-50",
  ENDED: "text-gray-500 bg-gray-100",
  EXPIRED: "text-gray-500 bg-gray-100",
}

function AdjustmentBadge({ adj }: { adj: SubscriptionAdjustmentDto }) {
  const t = useTranslations("mypage.membership")

  const adjLabel = (() => {
    const days = adj.days
    switch (adj.eventType) {
      case "GRANTED_BY_ADMIN":
        return { text: t("history.adjGrantedByAdmin", { days }), className: "font-semibold text-purple-600", showReason: true }
      case "ENTITLEMENT_EXTENDED":
        return { text: t("history.adjExtended", { days }), className: "font-semibold text-blue-600", showReason: false }
      default:
        return { text: t("history.adjReduced", { days: Math.abs(days) }), className: "font-semibold text-orange-500", showReason: false }
    }
  })()

  return (
    <div className="rounded-lg bg-white border border-gray-100 px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-gray-600">{formatDate(adj.createdAt, DATE_FORMATS.KO_DOT)}</span>
        <span className={adjLabel.className}>{adjLabel.text}</span>
        <span className="text-gray-400">{t("billing.expirePast", { date: formatDate(adj.newEndsAt, DATE_FORMATS.KO_DOT) })}</span>
      </div>
      {adjLabel.showReason && adj.reason && (
        <p className="mt-1 text-gray-500">{t("history.adjReasonPrefix", { reason: adj.reason })}</p>
      )}
    </div>
  )
}

function HistoryCard({ item }: { item: SubscriptionHistoryItemDto }) {
  const t = useTranslations("mypage.membership")
  const [open, setOpen] = useState(false)
  const startDate = item.startDate ?? item.createdAt
  const cancelledEndDate = item.cancelledAt ?? item.endDate ?? null
  const today = new Date()
  const isInTrial = !!item.billingDate && item.status === "ACTIVE" && new Date(item.billingDate) > today
  const displayNextBillingDate = isInTrial ? item.billingDate : item.nextBillingDate

  const fmt = (d?: string | null) => formatDate(d, DATE_FORMATS.KO_DOT)

  const planLabel = (durationDays?: number): string => {
    if (!durationDays) return ""
    if (durationDays <= 31) return t("subscription.monthly")
    if (durationDays >= 360) return t("subscription.annual")
    return t("subscription.daysSubscription", { days: durationDays })
  }

  const statusLabel = (status: string): string => {
    try {
      return t(`status.${status}` as `status.ACTIVE`)
    } catch {
      return status
    }
  }

  const headerDateSuffix = (): string => {
    if (item.status === "ACTIVE" && item.endDate)
      return t("billing.expireSuffix", { date: fmt(item.endDate) })
    if (item.status !== "ACTIVE" && cancelledEndDate) return ` ~ ${fmt(cancelledEndDate)}`
    return ""
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
      >
        <div className="flex flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">
              {t("membershipName")}
            </span>
            {item.plan && (
              <span className="text-xs text-gray-400">
                {planLabel(item.plan.durationDays)}
              </span>
            )}
          </div>
          <span className="text-xs text-gray-500">
            {fmt(startDate)}{headerDateSuffix()}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[item.status] ?? "text-gray-500 bg-gray-100"}`}
          >
            {statusLabel(item.status)}
          </span>
          {open ? (
            <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-gray-100 bg-gray-50 px-3 py-3 text-xs text-gray-700">
          <div className="grid grid-cols-2 gap-y-2">
            <span className="text-gray-400">{t("billing.subscriptionAmount")}</span>
            <span className="font-medium text-gray-900">
              {item.plan ? t("billing.amountWon", { amount: item.plan.price.toLocaleString() }) : "-"}
            </span>
            <span className="text-gray-400">{t("billing.subscriptionType")}</span>
            <span className="font-medium text-gray-900">
              {item.plan ? planLabel(item.plan.durationDays) : "-"}
            </span>
            <span className="text-gray-400">{t("billing.recurring")}</span>
            <span className="font-medium text-gray-900">
              {item.autoRenewal === undefined
                ? "-"
                : item.autoRenewal
                  ? t("billing.recurring")
                  : t("billing.oneTime")}
            </span>
            <span className="text-gray-400">{t("billing.subscriptionStartDate")}</span>
            <span className="font-medium text-gray-900">{fmt(startDate)}</span>
            {item.status === "ACTIVE" ? (
              <>
                <span className="text-gray-400">{t("billing.expectedEndDate")}</span>
                <span className="font-medium text-gray-900">{fmt(item.endDate)}</span>
                <span className="text-gray-400">
                  {isInTrial ? t("billing.autoStartDate") : t("billing.nextBillingDate")}
                </span>
                <span className="font-medium text-gray-900">{fmt(displayNextBillingDate)}</span>
              </>
            ) : (
              <>
                <span className="text-gray-400">{t("billing.endDateLabel")}</span>
                <span className="font-medium text-gray-900">{fmt(cancelledEndDate)}</span>
              </>
            )}
            {item.cancelledAt && (
              <>
                <span className="text-gray-400">{t("billing.cancelledDate")}</span>
                <span className="font-medium text-gray-900">{fmt(item.cancelledAt)}</span>
              </>
            )}
          </div>
          {item.adjustments && item.adjustments.length > 0 && (
            <div className="mt-3 border-t border-gray-200 pt-3">
              <p className="mb-2 font-semibold text-gray-700">{t("history.adjustmentsTitle")}</p>
              <div className="flex flex-col gap-1.5">
                {item.adjustments.map((adj) => (
                  <AdjustmentBadge key={adj.id} adj={adj} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function MembershipHistorySection({
  rangeSavings,
  subscriptionHistory,
  benefitHistory,
}: MembershipHistorySectionProps) {
  const t = useTranslations("mypage.membership")

  const formatMonth = (value: string) => {
    const [year, month] = value.split("-")
    if (!year || !month) return value
    return t("subscription.yearMonthFormat", { year, month: Number(month) })
  }

  const sortedMonthlyBreakdown = rangeSavings?.monthlyBreakdown
    ? [...rangeSavings.monthlyBreakdown].sort((a, b) =>
        b.yearMonth.localeCompare(a.yearMonth)
      )
    : []

  const sortedCycles = benefitHistory?.cycles
    ? [...benefitHistory.cycles].sort((a, b) =>
        b.cycleStartDate.localeCompare(a.cycleStartDate)
      )
    : []

  const sortedSubscriptionHistory = [...subscriptionHistory].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )

  return (
    <section className="mt-6 flex flex-col gap-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{t("history.savingsTitle")}</h3>
          {rangeSavings?.totalSavings != null && (
            <p className="text-xs text-gray-500">
              {t("history.savingsTotal", { amount: rangeSavings.totalSavings.toLocaleString() })}
            </p>
          )}
        </div>
        <div className="mt-3 space-y-2">
          {sortedMonthlyBreakdown.length ? (
            sortedMonthlyBreakdown.map((item) => (
              <div
                key={item.yearMonth}
                className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm"
              >
                <span className="font-medium text-gray-800">
                  {formatMonth(item.yearMonth)}
                </span>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span>{t("billing.orderCountUnit", { count: item.orderCount.toLocaleString() })}</span>
                  <span className="font-semibold text-gray-900">
                    {t("billing.amountWon", { amount: item.savings.toLocaleString() })}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500">{t("history.savingsEmpty")}</p>
          )}
        </div>
      </div>

      {benefitHistory && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">{t("history.benefitsTitle")}</h3>
            <p className="text-xs text-gray-500">
              {t("history.benefitsTotal", { amount: benefitHistory.totalDiscountAllTime.toLocaleString() })}
            </p>
          </div>
          <div className="mt-3 space-y-2">
            {sortedCycles.length ? (
              sortedCycles.map((cycle) => (
                <div
                  key={`${cycle.cycleStartDate}-${cycle.cycleEndDate}`}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-gray-800">
                    {formatDate(cycle.cycleStartDate, DATE_FORMATS.KO_DOT)} ~{" "}
                    {formatDate(cycle.cycleEndDate, DATE_FORMATS.KO_DOT)}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <span>{t("billing.orderCountUnit", { count: cycle.orderCount.toLocaleString() })}</span>
                    <span className="font-semibold text-gray-900">
                      {t("billing.amountWon", { amount: cycle.totalDiscountAmount.toLocaleString() })}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">{t("history.benefitsEmpty")}</p>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">{t("history.subscriptionHistory")}</h3>
        {sortedSubscriptionHistory.length ? (
          <div className="flex flex-col gap-2">
            {sortedSubscriptionHistory.map((item) => (
              <HistoryCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">{t("history.noSubscriptionHistory")}</p>
        )}
      </div>
    </section>
  )
}
