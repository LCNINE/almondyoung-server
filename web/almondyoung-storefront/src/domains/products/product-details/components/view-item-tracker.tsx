"use client"

import { useEffect } from "react"

import { trackEvent } from "@/lib/analytics/gtag"

interface ViewItemTrackerProps {
  itemId: string
  itemName: string
  price: number
  currency: string
}

/**
 * GA4 ecommerce `view_item` 이벤트. 상품 상세 진입 시 발사한다.
 * 같은 상품을 다시 보는 것도 유효한 조회이므로 sessionStorage 가드를 두지 않는다.
 */
export function ViewItemTracker({
  itemId,
  itemName,
  price,
  currency,
}: ViewItemTrackerProps) {
  useEffect(() => {
    trackEvent("view_item", {
      currency,
      value: price,
      items: [{ item_id: itemId, item_name: itemName, price, quantity: 1 }],
    })
  }, [itemId, itemName, price, currency])

  return null
}
