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
  /**
   * `router.refresh()` **전에** 한 번 기다렸다 부를 일. 카트·체크아웃은 여기서 가격 재계산을
   * 건다 — 다시 받기만 해서는 세일이 끝나도 라인에 박힌 옛 세일가가 그대로 온다.
   */
  onEnd?: () => void | Promise<void>
  compact?: boolean
  /** 24시간 이하로 남았을 때만 그린다. 그 위로는 아무것도 렌더하지 않는다. */
  clockOnly?: boolean
  className?: string
}

export function TimeSaleCountdown({
  endsAt,
  refreshOnEnd,
  onEnd,
  compact,
  clockOnly,
  className,
}: Props) {
  const router = useRouter()
  // 종료 처리는 한 번만. onEnd 가 매 렌더 새 함수여도 effect 가 되돌지 않게 막는다.
  const endedRef = useRef(false)
  const t = useTranslations("home.timeSale")
  // 서버 렌더에서는 아무것도 그리지 않는다 — 서버 시각으로 그린 뒤 브라우저 시각으로 다시 그리면
  // 하이드레이션이 어긋난다.
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
  }, [])

  useEffect(() => {
    if (now === null) return

    const delay = nextTickDelayMs(endsAt, now)
    if (delay <= 0) {
      if (refreshOnEnd && !endedRef.current) {
        endedRef.current = true
        void (async () => {
          await onEnd?.()
          router.refresh()
        })()
      }
      return
    }

    const timer = setTimeout(() => setNow(Date.now()), delay)
    return () => clearTimeout(timer)
  }, [endsAt, now, refreshOnEnd, onEnd, router])

  if (now === null) return null

  const view = resolveCountdown(endsAt, now)
  if (clockOnly && view.kind !== "clock") return null
  if (view.kind === "ended") return null

  if (compact) {
    return <span className={className}>{formatCountdown(view)}</span>
  }

  return (
    <span className={className}>
      <Clock className="inline-block h-[1em] w-[1em] align-[-0.1em]" aria-hidden />
      <span className="ml-1 tabular-nums">
        {t("endsIn", { remaining: formatCountdown(view) })}
      </span>
    </span>
  )
}
