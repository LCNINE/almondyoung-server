"use client"

import { Clock } from "lucide-react"
import { useTranslations } from "next-intl"
import { useCountdownNow } from "@/components/shared/time-sale-countdown"
import { formatCountdown, resolveCountdown } from "@/lib/utils/time-sale-countdown"

/**
 * 카드 썸네일 위 타임세일 표시. 하루 넘게 남으면 「타임세일 · 1일」, 24시간 안이면 「타임세일 · 12:34:56」.
 *
 * 첫 페인트에는 남은 시간 없이 「타임세일」만 그린다 — 남은 시간은 브라우저 시각으로만 계산한다.
 * 끝나면 배지만 내린다. 카드 가격은 다음에 화면을 받을 때 원래대로 돌아온다.
 */
export function TimeSaleBadge({ endsAt }: { endsAt: string }) {
  const t = useTranslations("home.timeSale")
  const now = useCountdownNow(endsAt)
  const view = now === null ? null : resolveCountdown(endsAt, now)

  if (view?.kind === "ended") return null

  return (
    <span className="bg-red-30 inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-white tabular-nums">
      <Clock className="size-3" aria-hidden />
      {t("badge")}
      {view && ` · ${formatCountdown(view, t("dayUnit"))}`}
    </span>
  )
}
