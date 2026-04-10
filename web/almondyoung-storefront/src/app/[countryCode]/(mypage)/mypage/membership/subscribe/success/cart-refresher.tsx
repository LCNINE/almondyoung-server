"use client"

import { useEffect } from "react"
import { refreshCartPrices } from "@/lib/api/medusa/cart"

/**
 * 멤버십 가입 완료 후 카트 가격 자동 갱신.
 *
 * 흐름: 결제 콜백 → confirm-checkout-intent → Kafka 이벤트 → 채널 어댑터
 *   → Medusa 그룹 할당 → admin refresh-cart-prices (Medusa 갱신)
 */
export function CartRefresher() {
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        await refreshCartPrices()
      } catch {
        // 카트 없거나 인증 문제면 무시
      }
    }, 6000)

    return () => clearTimeout(timer)
  }, [])

  return null
}
