"use client"

import { ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"
import {
  getCurrentMonthSavings,
  getCurrentSubscription,
} from "@/lib/api/membership"
import Link from "next/link"

interface SavingsData {
  totalSavings: number
  hasSubscription: boolean
  tierName?: string
}

export function SavingsBanner() {
  const [savingsData, setSavingsData] = useState<SavingsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchSavingsData = async () => {
      try {
        const [savings, subscription] = await Promise.all([
          getCurrentMonthSavings().catch(() => null),
          getCurrentSubscription().catch(() => null),
        ])

        setSavingsData({
          totalSavings: savings?.totalSavings ?? 0,
          hasSubscription: subscription?.status === "ACTIVE",
          tierName: subscription?.plan?.tier?.name || undefined,
        })
      } catch (error) {
        console.error("절약액 조회 실패:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchSavingsData()
  }, [])

  if (isLoading || !savingsData?.hasSubscription) {
    return null
  }

  const { totalSavings, tierName } = savingsData

  return (
    <Link href="/kr/mypage/membership">
      <section
        aria-label="절약 금액 안내"
        className="flex items-center justify-between rounded-lg bg-yellow-100 p-3 text-sm transition-opacity hover:opacity-80"
      >
        <div className="flex items-center gap-2">
          {tierName && (
            <span className="rounded bg-purple-200 px-2 py-0.5 text-xs font-bold text-purple-800">
              {tierName}
            </span>
          )}
          <p className="font-semibold">
            이번달 <strong>{totalSavings.toLocaleString()}원</strong>{" "}
            절약했어요!
          </p>
        </div>
        <ChevronRight className="h-5 w-5" />
      </section>
    </Link>
  )
}
