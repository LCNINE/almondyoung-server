import { ChevronRight } from "lucide-react"
import Link from "next/link"
import type { SavingsData } from "../../types/mypage-types"

interface SavingsBannerProps {
  initialData: SavingsData
}

export function SavingsBanner({ initialData }: SavingsBannerProps) {
  if (!initialData.hasSubscription) {
    return null
  }

  const { totalSavings, tierName } = initialData

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
