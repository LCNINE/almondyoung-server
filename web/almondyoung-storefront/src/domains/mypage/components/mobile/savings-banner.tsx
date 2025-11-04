import { ChevronRight } from "lucide-react"

export function SavingsBanner() {
  return (
    <section
      aria-label="절약 금액 안내"
      className="flex items-center justify-between rounded-lg bg-yellow-100 p-3 text-sm"
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-yellow-300 px-2 py-0.5 text-xs font-bold text-yellow-800">
          경비처리
        </span>
        <span className="rounded bg-purple-200 px-2 py-0.5 text-xs font-bold text-purple-800">
          pro
        </span>
        <p className="font-semibold">
          총 <strong>61,120원</strong> 절약했어요!
        </p>
      </div>
      <ChevronRight className="h-5 w-5" />
    </section>
  )
}
