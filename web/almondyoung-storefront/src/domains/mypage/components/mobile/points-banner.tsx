import { ChevronRight } from "lucide-react"

export function PointsBanner() {
  return (
    <section className="flex w-full items-center justify-between rounded-[10px] bg-white px-4 py-3.5 shadow-sm">
      {/* Left Side: 상태 메시지 */}
      <p className="text-[11px] font-medium text-[#2c2c2e]">
        최근 30일 내 적립내역이 없어요
      </p>

      {/* Right Side: 적립금 정보 및 아이콘 */}
      <div className="flex items-center gap-1.5">
        {/* 정보 그룹 */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-black">적립금</span>
          <span className="text-sm font-bold text-black">620 원</span>
        </div>

        {/* Icon: lucide-react 교체 */}
        {/* stroke-[#757575] -> text-[#757575] */}
        <ChevronRight className="h-[18px] w-[18px] text-[#757575]" />
      </div>
    </section>
  )
}
