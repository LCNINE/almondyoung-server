"use client"

import { useEffect } from "react"
import { refreshCartPrices } from "@/lib/api/medusa/cart"

/**
 * 멤버십 가입 완료 후 카트 가격 자동 갱신.
 *
 * 흐름: 결제 콜백 → confirm-checkout-intent → Kafka 이벤트 → 채널 어댑터
 *   → Medusa 그룹 할당 → admin refresh-cart-prices (Medusa 갱신)
 *
 * 임의 딜레이 대신 hasMembershipGroup === true가 될 때까지 3초 간격으로 폴링
 * 최대 30초 후 자동 종료
 */
const POLL_INTERVAL_MS = 3_000
const MAX_DURATION_MS = 30_000

export function CartRefresher() {
  useEffect(() => {
    const startedAt = Date.now()
    let timerId: ReturnType<typeof setTimeout>

    const poll = () => {
      timerId = setTimeout(async () => {
        const result = await refreshCartPrices().catch(() => null)

        // null → 카트 없음, true → 그룹 반영 완료: 둘 다 폴링 종료
        if (!result || result.hasMembershipGroup !== false) return

        // 아직 그룹 미반영: 타임아웃 내에서 재시도
        if (Date.now() - startedAt < MAX_DURATION_MS) {
          poll()
        }
      }, POLL_INTERVAL_MS)
    }

    poll()
    return () => clearTimeout(timerId)
  }, [])

  return null
}
