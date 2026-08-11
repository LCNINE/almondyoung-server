import { PointBalanceCard } from "@/domains/mypage/components/point/balance-card"
import { getDefaultRange } from "@/domains/mypage/components/point/history/default-range"
import { PointHistoryFilterBar } from "@/domains/mypage/components/point/history/filter-bar"
import { PointHistoryItem } from "@/domains/mypage/components/point/history/item"
import { PointHistoryPagination } from "@/domains/mypage/components/point/history/pagination"
import {
  getPointBalance,
  getPointExpiring,
  getPointHistory,
} from "@/lib/api/wallet"
import type { PointsEventRow } from "@/lib/types/ui/wallet"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { AlertCircle } from "lucide-react"
import {
  endOfDay,
  endOfMonth,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
} from "date-fns"
import { getTranslations } from "next-intl/server"

const PAGE_SIZE = 10

interface PointTemplateProps {
  page?: number
  year?: string
  month?: string
  from?: string
  to?: string
}

function resolveDateRange({
  year,
  month,
  from,
  to,
}: Pick<PointTemplateProps, "year" | "month" | "from" | "to">): {
  dateFrom: string
  dateTo: string
} {
  const fromDate = from ? parseISO(from) : null
  const toDate = to ? parseISO(to) : null
  if (fromDate && isValid(fromDate) && toDate && isValid(toDate)) {
    return {
      dateFrom: startOfDay(fromDate).toISOString(),
      dateTo: endOfDay(toDate).toISOString(),
    }
  }

  const yearNum = Number(year)
  const monthNum = Number(month)
  const validMonth =
    Number.isFinite(yearNum) &&
    Number.isFinite(monthNum) &&
    monthNum >= 1 &&
    monthNum <= 12
  if (!validMonth) {
    const { from: defaultFrom, to: defaultTo } = getDefaultRange()
    return {
      dateFrom: defaultFrom.toISOString(),
      dateTo: endOfDay(defaultTo).toISOString(),
    }
  }

  const monthStart = startOfMonth(new Date(yearNum, monthNum - 1, 1))
  return {
    dateFrom: monthStart.toISOString(),
    dateTo: endOfMonth(monthStart).toISOString(),
  }
}

const POLICY_ITEMS = ["expiry", "refund", "abuse", "withdrawal"] as const

export async function PointTemplate({
  page = 1,
  year,
  month,
  from,
  to,
}: PointTemplateProps) {
  const t = await getTranslations("mypage.point")
  const currentPage = Math.max(1, Math.floor(page) || 1)
  const { dateFrom, dateTo } = resolveDateRange({ year, month, from, to })

  const [balance, expiring, pointHistory] = await Promise.all([
    getPointBalance().catch(() => ({
      confirmed: 0,
      reserved: 0,
      available: 0,
    })),
    getPointExpiring().catch(() => ({ amount: 0, expiresAt: null })),
    getPointHistory({
      page: currentPage,
      limit: PAGE_SIZE,
      dateFrom,
      dateTo,
    }),
  ])

  const events = pointHistory.data as PointsEventRow[]
  const totalPages = Math.max(
    1,
    Math.ceil(pointHistory.total / pointHistory.limit)
  )

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-10">
      <PointBalanceCard balance={balance} />

      {expiring.expiresAt && expiring.amount > 0 && (
        <div
          role="status"
          className="mt-4 flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3"
        >
          <AlertCircle className="text-primary mt-0.5 size-4 shrink-0" />
          <p className="text-gray-90 text-sm leading-relaxed">
            {t.rich("expiring.notice", {
              amount: expiring.amount,
              date: formatDate(expiring.expiresAt, DATE_FORMATS.KO_DOT),
              strong: (chunks) => (
                <span className="text-primary font-bold">{chunks}</span>
              ),
            })}
          </p>
        </div>
      )}

      <header className="mt-8 mb-4 flex items-end justify-between gap-4 md:mt-10">
        <h2 className="text-gray-90 text-xl font-bold md:text-2xl">
          {t("historyTitle")}
        </h2>
        <p className="text-gray-40 text-sm tabular-nums">
          {t.rich("totalCount", {
            count: pointHistory.total,
            strong: (chunks) => (
              <span className="text-gray-90 font-semibold">{chunks}</span>
            ),
          })}
        </p>
      </header>

      <div className="mb-4">
        <PointHistoryFilterBar />
      </div>

      {events.length === 0 ? (
        <div className="border-gray-10 flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed bg-gray-50 p-10 text-center">
          <p className="text-gray-60 text-base font-medium">{t("emptyTitle")}</p>
          <p className="text-gray-40 mt-1 text-sm">{t("emptyDescription")}</p>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {events.map((event) => (
              <PointHistoryItem key={event.id} event={event} />
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="mt-8">
              <PointHistoryPagination
                currentPage={pointHistory.page}
                totalPages={totalPages}
              />
            </div>
          )}
        </>
      )}

      <aside className="border-gray-10 mt-8 rounded-xl border bg-gray-50 p-4 md:mt-10 md:p-5">
        <h3 className="text-gray-90 text-sm font-semibold">
          {t("policy.title")}
        </h3>
        <p className="text-gray-60 mt-2 text-xs leading-relaxed">
          {t("policy.intro")}
        </p>
        <ul className="text-gray-60 mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed">
          {POLICY_ITEMS.map((key) => (
            <li key={key}>{t(`policy.${key}`)}</li>
          ))}
        </ul>
      </aside>
    </section>
  )
}
