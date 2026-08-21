"use client"

import { useEffect, useRef } from "react"

import { GaPromotion, trackEvent } from "@/lib/analytics/gtag"

/** GA4 `view_promotion`(노출 50% 시 1회) / `select_promotion`(내부 링크 클릭) 이벤트. */
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
        if (!entry.isIntersecting || viewed.current) return
        viewed.current = true
        trackEvent("view_promotion", promotion)
        observer.disconnect()
      },
      { threshold: 0.5 }
    )
    observer.observe(el)

    return () => observer.disconnect()
  }, [promotion])

  return (
    <div
      ref={ref}
      className={className}
      onClick={() => trackEvent("select_promotion", promotion)}
    >
      {children}
    </div>
  )
}
