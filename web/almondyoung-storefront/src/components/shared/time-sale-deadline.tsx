"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import {
  formatClock,
  resolveSectionCountdown,
  scheduleRefreshAfterEnd,
} from "@/lib/utils/time-sale-countdown"

/**
 * 섹션 헤더의 마감 표시.
 *
 * 초가 움직이는 타이머가 본체고 날짜는 곁들이다. 하루가 넘게 남아도 시:분:초를 보여준다 —
 * "2일" 로만 두면 이틀 내내 화면이 멈춰 있어 타임세일로 읽히지 않는다.
 *
 * 서버에서는 아무것도 그리지 않는다. 남은 시간은 물론 마감 날짜도 런타임 타임존을 따르는데
 * 서버는 UTC 라, 서버가 그린 값을 브라우저(KST)가 다시 그리면 하이드레이션이 어긋난다.
 * 자리는 먼저 잡아 둬서 붙는 순간 레이아웃이 밀리지 않게 한다.
 */
export function TimeSaleDeadline({
  endsAt,
  className,
}: {
  endsAt: string
  className?: string
}) {
  const t = useTranslations("home.timeSale")
  const router = useRouter()
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const countdown = now === null ? null : resolveSectionCountdown(endsAt, now)
  const ended = now !== null && countdown === null

  useEffect(() => {
    if (ended) scheduleRefreshAfterEnd(endsAt, () => router.refresh())
  }, [ended, endsAt, router])

  if (ended) return null

  const clock = countdown ? formatClock(countdown) : "00:00:00"
  const tone = countdown?.isUrgent ? "text-[#f04452]" : "text-[#191f28]"

  return (
    <span className={cn("flex", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-2.5",
          !countdown && "invisible"
        )}
      >
        <span
          className={cn(
            "text-[14px] leading-none font-semibold md:text-[15px]",
            countdown?.isUrgent ? "text-[#f04452]" : "text-[#8b95a1]"
          )}
        >
          {countdown?.isUrgent ? t("endingSoon") : t("untilEnd")}
        </span>
        <span
          className={cn(
            "text-[20px] leading-none font-bold tracking-[-0.02em] tabular-nums md:text-[22px]",
            tone,
            countdown?.isUrgent && "motion-safe:animate-pulse"
          )}
        >
          {countdown && countdown.days > 0 && `${countdown.days}${t("dayUnit")} `}
          {clock}
        </span>
      </span>
    </span>
  )
}
