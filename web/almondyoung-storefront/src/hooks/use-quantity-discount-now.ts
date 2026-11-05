"use client"

import { useEffect, useState } from "react"
import { msUntilNextBoundary } from "@/lib/utils/quantity-discount"

type Metadata = Record<string, unknown> | null | undefined

/** 수량 할인 기간 판정에 쓰는 «지금». 열린 화면이 기간 경계를 지나면 그 순간 다시 그리게 한다. */
export function useQuantityDiscountNow(productMetadatas: Metadata[]): Date {
  const [now, setNow] = useState(() => new Date())
  const delay = msUntilNextBoundary(productMetadatas, now)

  useEffect(() => {
    if (delay === null) return
    const timer = setTimeout(() => setNow(new Date()), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return now
}
