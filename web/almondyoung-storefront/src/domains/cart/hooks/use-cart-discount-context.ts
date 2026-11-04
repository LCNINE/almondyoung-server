"use client"

import { useQuantityDiscountNow } from "@/hooks/use-quantity-discount-now"
import { useCallback, useMemo } from "react"
import { lineTimeSale, useTimeSale } from "@/components/providers/time-sale-provider"
import type { CartDiscountContext } from "../utils/calculate-discount"

type Line = Parameters<typeof lineTimeSale>[1] & {
  quantity: number
  unit_price: number
}

/** 장바구니·결제 요약에서 «수량 할인»을 따로 세기 위한 맥락(회원 여부·타임세일 라인·지금 시각). */
export function useCartDiscountContext<T extends Line>(
  isMember: boolean,
  items: Array<{ product?: { metadata?: Record<string, unknown> | null } | null }> | null | undefined
): CartDiscountContext<T> {
  const { sales } = useTimeSale()
  const now = useQuantityDiscountNow((items ?? []).map((item) => item.product?.metadata))
  const isTimeSaleLine = useCallback((item: T) => lineTimeSale(sales, item) !== null, [sales])
  return useMemo(() => ({ isMember, isTimeSaleLine, now }), [isMember, isTimeSaleLine, now])
}
