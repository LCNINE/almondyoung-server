"use client"

import { useEffect } from "react"

interface PurchaseItem {
  item_id: string
  item_name: string
  price: number
  quantity: number
}

interface PurchaseTrackerProps {
  transactionId: string
  value: number
  currency: string
  items: PurchaseItem[]
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
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
    if (typeof window === "undefined" || !window.gtag) return

    const key = `ga4_purchase_${transactionId}`
    if (sessionStorage.getItem(key)) return

    window.gtag("event", "purchase", {
      transaction_id: transactionId,
      value,
      currency,
      items,
    })
    sessionStorage.setItem(key, "1")
  }, [transactionId, value, currency, items])

  return null
}
