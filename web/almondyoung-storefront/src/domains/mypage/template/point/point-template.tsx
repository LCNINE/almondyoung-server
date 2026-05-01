import { PointBalanceCard } from "@/domains/mypage/components/point/balance-card"
import { PointHistoryFilterBar } from "@/domains/mypage/components/point/history/filter-bar"
import { PointHistoryItem } from "@/domains/mypage/components/point/history/item"
import { PointHistoryPagination } from "@/domains/mypage/components/point/history/pagination"
import { getPointBalance, getPointHistory } from "@/lib/api/wallet"
import type { PointsEventRow } from "@/lib/types/ui/wallet"
import {
  endOfDay,
  endOfMonth,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
} from "date-fns"

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

  const now = new Date()
  const yearNum = Number(year)
  const monthNum = Number(month)
  const validMonth =
    Number.isFinite(yearNum) &&
    Number.isFinite(monthNum) &&
    monthNum >= 1 &&
    monthNum <= 12
  const y = validMonth ? yearNum : now.getFullYear()
  const m = validMonth ? monthNum : now.getMonth() + 1
  const monthStart = startOfMonth(new Date(y, m - 1, 1))
  return {
    dateFrom: monthStart.toISOString(),
    dateTo: endOfMonth(monthStart).toISOString(),
  }
}

export async function PointTemplate({
  page = 1,
  year,
  month,
  from,
  to,
}: PointTemplateProps) {
  const currentPage = Math.max(1, Math.floor(page) || 1)
  const { dateFrom, dateTo } = resolveDateRange({ year, month, from, to })

  const [balance, pointHistory] = await Promise.all([
    getPointBalance().catch(() => ({
      confirmed: 0,
      reserved: 0,
      available: 0,
    })),
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

      <header className="mt-8 mb-4 flex items-end justify-between gap-4 md:mt-10">
        <h2 className="text-gray-90 text-xl font-bold md:text-2xl">
          포인트 내역
        </h2>
        <p className="text-gray-40 text-sm tabular-nums">
          총{" "}
          <span className="text-gray-90 font-semibold">
            {pointHistory.total.toLocaleString("ko-KR")}
          </span>
          건
        </p>
      </header>

      <div className="mb-4">
        <PointHistoryFilterBar />
      </div>

      {events.length === 0 ? (
        <div className="border-gray-10 flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed bg-gray-50 p-10 text-center">
          <p className="text-gray-60 text-base font-medium">
            선택한 기간에 포인트 내역이 없어요
          </p>
          <p className="text-gray-40 mt-1 text-sm">다른 기간을 선택해보세요.</p>
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
    </section>
  )
}
