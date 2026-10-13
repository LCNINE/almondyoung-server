"use client"

import { useEffect, useRef } from "react"

import { GaPromotion, trackEvent } from "@/lib/analytics/gtag"

type VisibilityEntry = Pick<
  IntersectionObserverEntry,
  "isIntersecting" | "intersectionRatio"
> & {
  intersectionRect: Pick<DOMRectReadOnly, "height">
  rootBounds: Pick<DOMRectReadOnly, "height"> | null
}

/**
 * 섹션의 50% 가 보이거나, 섹션이 화면 높이의 절반 이상을 채우면 노출이다.
 * 뒤쪽 기준이 없으면 화면의 두 배를 넘는 섹션(상품 40개짜리 더보기)은 비율 50% 에 닿지 않아 한 번도 안 잡힌다.
 */
export function isPromotionVisible(entry: VisibilityEntry): boolean {
  if (!entry.isIntersecting) return false
  if (entry.intersectionRatio >= 0.5) return true

  const viewport = entry.rootBounds?.height ?? 0
  return viewport > 0 && entry.intersectionRect.height >= viewport * 0.5
}

// 긴 섹션은 비율이 조금씩만 오르므로 여러 단계에서 다시 판정한다.
const THRESHOLDS = Array.from({ length: 11 }, (_, i) => i * 0.05)

/** GA4 `view_promotion`(노출 시 1회) / `select_promotion`(내부 링크 클릭) 이벤트. */
export function PromotionTracker({
  promotion,
  className,
  children,
}: {
  promotion: GaPromotion
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const viewed = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el || viewed.current) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!isPromotionVisible(entry) || viewed.current) return
        viewed.current = true
        trackEvent("view_promotion", promotion)
        observer.disconnect()
      },
      { threshold: THRESHOLDS }
    )
    observer.observe(el)

    return () => observer.disconnect()
  }, [promotion])

  return (
    <div
      ref={ref}
      className={className}
      onClick={(event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest("a, button")
        )
          return

        trackEvent("select_promotion", promotion)
      }}
    >
      {children}
    </div>
  )
}
