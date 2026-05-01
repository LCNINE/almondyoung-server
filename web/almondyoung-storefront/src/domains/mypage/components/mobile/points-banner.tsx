import { ChevronRight } from "lucide-react"
import Link from "next/link"
import type { PointBalanceData } from "../../types/mypage-types"

interface PointsBannerProps {
  initialData: PointBalanceData
}

export function PointsBanner({ initialData }: PointsBannerProps) {
  const available = initialData.available
  const hasRecentActivity = available > 0

  return (
    <Link href="/kr/mypage/point">
      <section className="my-3 flex w-full items-center justify-between rounded-[10px] bg-white px-4 py-3.5 shadow-sm transition-opacity hover:opacity-80">
        {/* Left Side: 상태 메시지 */}
        <p className="text-[11px] font-medium text-[#2c2c2e]">
          {hasRecentActivity
            ? "포인트를 확인하세요"
            : "최근 30일 내 적립내역이 없어요"}
        </p>

        {/* Right Side: 적립금 정보 및 아이콘 */}
        <div className="flex items-center gap-1.5">
          {/* 정보 그룹 */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-black">적립금</span>
            <span className="text-sm font-bold text-black">
              {available.toLocaleString()} 원
            </span>
          </div>

          <ChevronRight className="h-[18px] w-[18px] text-[#757575]" />
        </div>
      </section>
    </Link>
  )
}
