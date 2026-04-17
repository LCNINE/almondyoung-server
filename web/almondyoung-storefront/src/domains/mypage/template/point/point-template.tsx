import { getPointHistory } from "@/lib/api/wallet"
import type { PointsEventRow } from "@/lib/types/ui/wallet"
import { PointHistoryItem } from "./point-history-item"
import { PointHistoryPagination } from "./point-history-pagination"

const PAGE_SIZE = 10

interface PointTemplateProps {
  page?: number
}

export async function PointTemplate({ page = 1 }: PointTemplateProps) {
  const currentPage = Math.max(1, Math.floor(page) || 1)

  const pointHistory = await getPointHistory({
    page: currentPage,
    limit: PAGE_SIZE,
  })

  const events = pointHistory.data as PointsEventRow[]
  const totalPages = Math.max(
    1,
    Math.ceil(pointHistory.total / pointHistory.limit)
  )

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-10">
      <header className="mb-5 flex items-end justify-between gap-4 md:mb-6">
        <div>
          <h2 className="text-gray-90 text-2xl font-bold md:text-3xl">
            최근 이용 내역
          </h2>
          <p className="text-gray-40 mt-1 text-sm">포인트 변동 내역</p>
        </div>
        <p className="text-gray-40 text-sm tabular-nums">
          총{" "}
          <span className="text-gray-90 font-semibold">
            {pointHistory.total.toLocaleString("ko-KR")}
          </span>
          건
        </p>
      </header>

      {events.length === 0 ? (
        <div className="border-gray-10 flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed bg-gray-50 p-10 text-center">
          <p className="text-gray-60 text-base font-medium">
            아직 포인트 변동 내역이 없어요
          </p>
          <p className="text-gray-40 mt-1 text-sm">
            혜택을 받고 다양한 활동을 시작해보세요.
          </p>
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
