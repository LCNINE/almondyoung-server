"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
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
  const router = useRouter()

  useEffect(() => {
    const startedAt = Date.now()
    let timerId: ReturnType<typeof setTimeout>
    let done = false

    const poll = () => {
      timerId = setTimeout(async () => {
        const result = await refreshCartPrices().catch(() => null)

        if (!result) return

        if (result.hasMembershipGroup !== false) {
          if (!done) {
            done = true
            router.refresh()
          }
          return
        }

        if (Date.now() - startedAt < MAX_DURATION_MS) {
          poll()
        }
      }, POLL_INTERVAL_MS)
    }

    poll()
    return () => clearTimeout(timerId)
  }, [router])

  return null
}
