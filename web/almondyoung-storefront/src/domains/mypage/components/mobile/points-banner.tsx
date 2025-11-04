import { ChevronRight } from "lucide-react"

export function PointsBanner() {
  return (
    <section
      aria-label="적립금 안내"
      className="flex items-center justify-between rounded-lg bg-white p-3 text-sm shadow-sm"
    >
      <p className="font-semibold text-gray-500">
        최근 30일 내 직접내역이 없어요
      </p>
      <div className="flex items-center gap-1 font-bold">
        <span>적립금</span>
        <span className="text-orange-500">620 원</span>
        <ChevronRight className="h-5 w-5" />
      </div>
    </section>
  )
}
