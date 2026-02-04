"use client"

import type { RangeSavingsDto } from "@lib/types/dto/membership-savings"
import type {
  CycleBenefitHistoryDto,
  SubscriptionHistoryItemDto,
} from "@lib/types/dto/membership"

interface MembershipHistorySectionProps {
  rangeSavings: RangeSavingsDto | null
  subscriptionHistory: SubscriptionHistoryItemDto[]
  benefitHistory: CycleBenefitHistoryDto | null
}

const formatMonth = (value: string) => {
  const [year, month] = value.split("-")
  if (!year || !month) return value
  return `${year}년 ${Number(month)}월`
}

const formatDate = (value?: string | null) => {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

const statusLabel = (status: string) => {
  switch (status) {
    case "ACTIVE":
      return "이용 중"
    case "CANCELLED":
      return "취소됨"
    case "ENDED":
      return "종료됨"
    case "EXPIRED":
      return "만료됨"
    default:
      return status
  }
}

export default function MembershipHistorySection({
  rangeSavings,
  subscriptionHistory,
  benefitHistory,
}: MembershipHistorySectionProps) {
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

  const sortedSubscriptionHistory = [...subscriptionHistory].sort((a, b) => {
    const aKey = a.startDate ?? a.billingDate ?? a.createdAt
    const bKey = b.startDate ?? b.billingDate ?? b.createdAt
    return bKey.localeCompare(aKey)
  })

  return (
    <section className="mt-6 flex flex-col gap-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">절약 기록</h3>
          {rangeSavings?.totalSavings != null && (
            <p className="text-xs text-gray-500">
              총 {rangeSavings.totalSavings.toLocaleString()}원
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
                  <span>{item.orderCount.toLocaleString()}건</span>
                  <span className="font-semibold text-gray-900">
                    {item.savings.toLocaleString()}원
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500">절약 내역이 없습니다.</p>
          )}
        </div>
      </div>

      {benefitHistory && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">혜택 기록</h3>
            <p className="text-xs text-gray-500">
              누적 {benefitHistory.totalDiscountAllTime.toLocaleString()}원
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
                    {formatDate(cycle.cycleStartDate)} ~{" "}
                    {formatDate(cycle.cycleEndDate)}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <span>{cycle.orderCount.toLocaleString()}건</span>
                    <span className="font-semibold text-gray-900">
                      {cycle.totalDiscountAmount.toLocaleString()}원
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">혜택 내역이 없습니다.</p>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">구독 이력</h3>
        <div className="mt-3 space-y-2">
          {sortedSubscriptionHistory.length ? (
            sortedSubscriptionHistory.map((item) => {
              const startDate =
                item.startDate ?? item.billingDate ?? item.createdAt
              const endDate =
                item.endDate ?? item.nextBillingDate ?? item.cancelledAt ?? null

              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-1 rounded-lg bg-gray-50 px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">
                      {statusLabel(item.status)}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDate(item.updatedAt)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">
                    {formatDate(startDate)} ~ {formatDate(endDate)}
                  </p>
                </div>
              )
            })
          ) : (
            <p className="text-sm text-gray-500">구독 이력이 없습니다.</p>
          )}
        </div>
      </div>
    </section>
  )
}
