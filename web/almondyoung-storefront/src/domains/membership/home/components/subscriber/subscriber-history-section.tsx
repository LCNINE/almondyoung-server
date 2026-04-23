"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
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

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "이용 중",
  CANCELLED: "취소됨",
  ENDED: "종료됨",
  EXPIRED: "만료됨",
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "text-green-600 bg-green-50",
  CANCELLED: "text-red-500 bg-red-50",
  ENDED: "text-gray-500 bg-gray-100",
  EXPIRED: "text-gray-500 bg-gray-100",
}

function planLabel(durationDays?: number): string {
  if (!durationDays) return ""
  if (durationDays <= 31) return "월간 구독"
  if (durationDays >= 360) return "연간 구독"
  return `${durationDays}일 구독`
}

function HistoryCard({ item }: { item: SubscriptionHistoryItemDto }) {
  const [open, setOpen] = useState(false)
  const startDate = item.billingDate ?? item.startDate ?? item.createdAt
  const endDate = item.cancelledAt ?? item.endDate ?? item.nextBillingDate ?? null

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
              {"아몬드영 멤버십"}
            </span>
            {item.plan && (
              <span className="text-xs text-gray-400">
                {planLabel(item.plan.durationDays)}
              </span>
            )}
          </div>
          <span className="text-xs text-gray-500">
            {formatDate(startDate)}
            {item.status !== "ACTIVE" && endDate ? ` ~ ${formatDate(endDate)}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[item.status] ?? "text-gray-500 bg-gray-100"}`}
          >
            {STATUS_LABEL[item.status] ?? item.status}
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
            <span className="text-gray-400">구독 금액</span>
            <span className="font-medium text-gray-900">
              {item.plan ? `${item.plan.price.toLocaleString()}원` : "-"}
            </span>
            <span className="text-gray-400">구독 유형</span>
            <span className="font-medium text-gray-900">
              {item.plan ? planLabel(item.plan.durationDays) : "-"}
            </span>
            <span className="text-gray-400">정기결제</span>
            <span className="font-medium text-gray-900">
              {item.autoRenewal === undefined ? "-" : item.autoRenewal ? "정기결제" : "일시결제"}
            </span>
            <span className="text-gray-400">구독 시작일</span>
            <span className="font-medium text-gray-900">{formatDate(startDate)}</span>
            {item.status === "ACTIVE" ? (
              <>
                <span className="text-gray-400">다음 결제일</span>
                <span className="font-medium text-gray-900">{formatDate(item.nextBillingDate)}</span>
              </>
            ) : (
              <>
                <span className="text-gray-400">종료일</span>
                <span className="font-medium text-gray-900">{formatDate(endDate)}</span>
              </>
            )}
            {item.cancelledAt && (
              <>
                <span className="text-gray-400">해지일</span>
                <span className="font-medium text-gray-900">{formatDate(item.cancelledAt)}</span>
              </>
            )}
          </div>
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
        <h3 className="mb-3 text-sm font-semibold text-gray-900">구독 이력</h3>
        {sortedSubscriptionHistory.length ? (
          <div className="flex flex-col gap-2">
            {sortedSubscriptionHistory.map((item) => (
              <HistoryCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">구독 이력이 없습니다.</p>
        )}
      </div>
    </section>
  )
}
