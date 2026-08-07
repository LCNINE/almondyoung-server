"use client"

import { useState, useTransition } from "react"
import { ChevronDown, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { getSavingsPeriodDetail } from "@lib/api/membership"
import type {
  SavingsOrderDto,
  SavingsOverviewDto,
  SavingsPeriodDto,
} from "@lib/types/dto/membership-savings"

interface SavingsSectionProps {
  overview: SavingsOverviewDto | null
}

/**
 * 멤버십 절약 금액 — 결제 주기 단위.
 *
 * 달력 월이 아니라 결제 주기로 끊는다. 환불 가능 여부가 결제 주기 기준으로 판정되므로, 화면이
 * 다른 경계를 쓰면 고객이 본 금액과 환불 판정 근거가 어긋난다.
 */
export default function SavingsSection({ overview }: SavingsSectionProps) {
  const t = useTranslations("mypage.membership")
  const periods = overview?.periods ?? []
  const [selectedId, setSelectedId] = useState<string>(
    overview?.currentPeriod?.id ?? periods[0]?.id ?? ""
  )
  const [orders, setOrders] = useState<SavingsOrderDto[] | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [isLoading, startTransition] = useTransition()

  const selected: SavingsPeriodDto | null =
    periods.find((p) => p.id === selectedId) ?? overview?.currentPeriod ?? null

  const periodLabel = (period: SavingsPeriodDto): string => {
    const range = `${formatDate(period.startDate, DATE_FORMATS.KO_DOT)} ~ ${formatDate(
      // 종료가 배타적이라 그대로 쓰면 다음 주기 첫날이 찍힌다 — 하루 빼서 이용 마지막 날을 보여준다.
      new Date(new Date(period.endDate).getTime() - 86_400_000).toISOString(),
      DATE_FORMATS.KO_DOT
    )}`
    return period.isCurrent ? `${range} · ${t("stats.currentPeriodTag")}` : range
  }

  const handleSelect = (periodId: string) => {
    setSelectedId(periodId)
    setOrders(null)
    if (detailOpen) loadOrders(periodId)
  }

  const loadOrders = (periodId: string) => {
    startTransition(async () => {
      try {
        const detail = await getSavingsPeriodDetail(periodId)
        setOrders(detail.orders)
      } catch {
        // 상세를 못 불러와도 합계는 이미 보인다 — 빈 목록으로 두고 다시 시도할 수 있게 남긴다.
        setOrders([])
      }
    })
  }

  const toggleDetail = () => {
    const next = !detailOpen
    setDetailOpen(next)
    if (next && !orders && selectedId) loadOrders(selectedId)
  }

  if (!overview || periods.length === 0) {
    return (
      <article className="flex w-full flex-col justify-center gap-1.5 rounded-2xl bg-white py-6">
        <h3 className="text-muted-foreground text-center text-sm font-medium">
          {t("stats.cycleSavings")}
        </h3>
        <div className="flex items-end justify-center gap-1">
          <span className="text-primary text-3xl font-bold">0</span>
          <span className="text-muted-foreground pb-1 text-sm">
            {t("stats.unitWon")}
          </span>
        </div>
      </article>
    )
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <article className="flex w-full flex-col justify-center gap-1.5 rounded-2xl bg-white py-6">
        <h3 className="text-muted-foreground text-center text-sm font-medium">
          {t("stats.cycleSavings")}
        </h3>
        <div className="flex items-end justify-center gap-1">
          <span className="text-primary text-3xl font-bold">
            {(selected?.totalSavings ?? 0).toLocaleString()}
          </span>
          <span className="text-muted-foreground pb-1 text-sm">
            {t("stats.unitWon")}
          </span>
        </div>
        <p className="text-muted-foreground text-center text-xs">
          {t("stats.cycleOrders")} {selected?.orderCount ?? 0}
          {t("stats.unitCount")}
        </p>
      </article>

      {/* 기간 선택 — 지난 주기와 전체 누적을 고객이 직접 고른다 */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="savings-period"
          className="text-muted-foreground text-xs font-medium"
        >
          {t("stats.periodSelectLabel")}
        </label>
        <div className="relative">
          <select
            id="savings-period"
            value={selectedId}
            onChange={(e) => handleSelect(e.target.value)}
            className="border-border text-foreground h-11 w-full appearance-none rounded-xl border bg-white px-3 pr-9 text-sm"
          >
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {periodLabel(period)}
              </option>
            ))}
          </select>
          <ChevronDown className="text-muted-foreground pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />
        </div>
      </div>

      {/* 전체 누적 — 가입 이래 얼마 아꼈는지 */}
      <div className="border-border flex items-center justify-between rounded-xl border bg-white px-4 py-3">
        <span className="text-muted-foreground text-sm">
          {t("stats.allTimeSavings")}
        </span>
        <span className="text-foreground text-sm font-bold">
          {overview.allTime.totalSavings.toLocaleString()}
          {t("stats.unitWon")}
          <span className="text-muted-foreground ml-1.5 text-xs font-normal">
            {overview.allTime.orderCount}
            {t("stats.unitCount")}
          </span>
        </span>
      </div>

      {/* 주문별 내역 — "정말 이만큼 아꼈나"를 대조할 수 있어야 한다 */}
      <div className="border-border overflow-hidden rounded-xl border bg-white">
        <button
          type="button"
          onClick={toggleDetail}
          aria-expanded={detailOpen}
          className="text-foreground flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        >
          <span>{t("stats.orderBreakdown")}</span>
          <ChevronDown
            className={`text-muted-foreground h-4 w-4 transition-transform ${
              detailOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {detailOpen && (
          <div className="border-border border-t px-4 py-3">
            {isLoading && !orders ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("stats.loadingBreakdown")}
              </div>
            ) : orders && orders.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {orders.map((order) => (
                  <li
                    key={order.orderId}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="text-muted-foreground shrink-0">
                      {formatDate(order.orderDate, DATE_FORMATS.KO_DOT)}
                    </span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate">
                      {order.orderId}
                    </span>
                    <span className="text-foreground shrink-0 font-medium">
                      {order.discountAmount.toLocaleString()}
                      {t("stats.unitWon")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground py-2 text-center text-xs">
                {t("stats.noBreakdown")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
