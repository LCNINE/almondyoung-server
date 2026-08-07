"use client"

import { useEffect } from "react"

import { GaItem, trackEventOnce } from "@/lib/analytics/gtag"

interface PurchaseTrackerProps {
  transactionId: string
  value: number
  currency: string
  items: GaItem[]
}

/**
 * GA4 ecommerce `purchase` 이벤트 전송. 결제 성공 페이지에서 1회 발사한다.
 * - GA가 미주입된 환경(dev 등)이면 window.gtag 가 없어 no-op.
 * - 새로고침 중복은 transaction_id 기준 sessionStorage 가드로 막는다
 *   (GA4 자체 dedupe 도 있지만 클라이언트에서 한 번 더 차단).
 */
export function PurchaseTracker({
  transactionId,
  value,
  currency,
  items,
}: PurchaseTrackerProps) {
  useEffect(() => {
    trackEventOnce(`ga4_purchase_${transactionId}`, "purchase", {
      transaction_id: transactionId,
      value,
      currency,
      items,
    })
  }, [transactionId, value, currency, items])

  return null
}
