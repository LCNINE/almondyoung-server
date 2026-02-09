"use client"

import { ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"
import { getPointBalance } from "@lib/api/wallet"
import Link from "next/link"

interface PointBalanceData {
  balance: number
  withdrawable: number
}

export function PointsBanner() {
  const [pointData, setPointData] = useState<PointBalanceData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchPointBalance = async () => {
      try {
        const data = await getPointBalance()
        setPointData(data)
      } catch (error) {
        console.error("포인트 잔액 조회 실패:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchPointBalance()
  }, [])

  if (isLoading) {
    return (
      <section className="flex w-full items-center justify-between rounded-[10px] bg-white px-4 py-3.5 shadow-sm">
        <p className="text-[11px] font-medium text-[#2c2c2e]">로딩 중...</p>
      </section>
    )
  }

  const balance = pointData?.balance ?? 0
  const hasRecentActivity = balance > 0

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
              {balance.toLocaleString()} 원
            </span>
          </div>

          <ChevronRight className="h-[18px] w-[18px] text-[#757575]" />
        </div>
      </section>
    </Link>
  )
}
