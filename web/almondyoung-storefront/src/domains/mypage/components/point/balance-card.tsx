import type { PointsBalance } from "@/lib/types/ui/wallet"

interface PointBalanceCardProps {
  balance: PointsBalance
}

export function PointBalanceCard({ balance }: PointBalanceCardProps) {
  const available = balance.available.toLocaleString("ko-KR")
  const reserved = balance.reserved.toLocaleString("ko-KR")
  const confirmed = balance.confirmed.toLocaleString("ko-KR")

  return (
    <section className="relative overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 p-5 shadow-sm md:p-6">
      <p className="text-sm font-medium text-stone-500">내 포인트</p>

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="text-4xl font-bold text-stone-900 tabular-nums md:text-5xl">
          {available}
        </span>
        <span className="text-xl font-semibold text-amber-600 md:text-2xl">
          P
        </span>
      </div>
      <p className="mt-1 text-xs text-stone-500">사용 가능</p>

      <div className="mt-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-600/40 to-transparent" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-stone-500">보류 중</p>
          <p className="mt-0.5 text-sm font-semibold text-stone-800 tabular-nums">
            {reserved} P
          </p>
        </div>
        <div>
          <p className="text-xs text-stone-500">누적 적립</p>
          <p className="mt-0.5 text-sm font-semibold text-stone-800 tabular-nums">
            {confirmed} P
          </p>
        </div>
      </div>
    </section>
  )
}
