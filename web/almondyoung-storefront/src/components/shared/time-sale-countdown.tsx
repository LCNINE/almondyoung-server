"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Clock } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  formatCountdown,
  nextTickDelayMs,
  resolveCountdown,
} from "@/lib/utils/time-sale-countdown"

type Props = {
  endsAt: string
  /** 0 이 되는 순간 서버 데이터를 다시 받는다. 카트처럼 가격이 바뀌는 화면에서 켠다. */
  refreshOnEnd?: boolean
  /** `router.refresh()` 전에 await 할 작업. 카트·체크아웃은 여기서 가격 재계산을 건다. */
  onEnd?: () => void | Promise<void>
  compact?: boolean
  className?: string
}

/**
 * 남은 시간 계산에 쓸 현재 시각. 서버 렌더와 첫 페인트에서는 null 이다 — 서버 시각으로 그린 뒤
 * 브라우저 시각으로 다시 그리면 하이드레이션이 어긋난다.
 *
 * 며칠 남은 동안은 임계값까지 자고(최대 1시간), 24시간 안으로 들어오면 1초마다 깬다.
 */
export function useCountdownNow(endsAt: string): number | null {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
  }, [])

  useEffect(() => {
    if (now === null) return
    const delay = nextTickDelayMs(endsAt, now)
    if (delay <= 0) return
    const timer = setTimeout(() => setNow(Date.now()), delay)
    return () => clearTimeout(timer)
  }, [endsAt, now])

  return now
}

export function TimeSaleCountdown({
  endsAt,
  refreshOnEnd,
  onEnd,
  compact,
  className,
}: Props) {
  const router = useRouter()
  // 종료 처리는 한 번만. onEnd 가 매 렌더 새 함수여도 effect 가 되돌지 않게 막는다.
  const endedRef = useRef(false)
  const t = useTranslations("home.timeSale")
  const now = useCountdownNow(endsAt)

  useEffect(() => {
    if (now === null || !refreshOnEnd || endedRef.current) return
    if (nextTickDelayMs(endsAt, now) > 0) return
    endedRef.current = true
    void (async () => {
      await onEnd?.()
      router.refresh()
    })()
  }, [endsAt, now, refreshOnEnd, onEnd, router])

  if (now === null) return null

  const view = resolveCountdown(endsAt, now)
  if (view.kind === "ended") return null

  if (compact) {
    return <span className={className}>{formatCountdown(view, t("dayUnit"))}</span>
  }

  return (
    <span className={className}>
      <Clock className="inline-block h-[1em] w-[1em] align-[-0.1em]" aria-hidden />
      <span className="ml-1 tabular-nums">
        {t("endsIn", { remaining: formatCountdown(view, t("dayUnit")) })}
      </span>
    </span>
  )
}
