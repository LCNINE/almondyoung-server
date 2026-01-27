/**
 * Medusa 가격 유틸 함수
 * - nextjs-starter-medusa 방식 참고
 * - Medusa 백엔드에서 계산된 값을 그대로 사용
 */

import { HttpTypes } from "@medusajs/types"

const isEmpty = (value: unknown): boolean =>
  value === null || value === undefined || value === ""

type ConvertToLocaleParams = {
  amount: number
  currency_code: string
  minimumFractionDigits?: number
  maximumFractionDigits?: number
  locale?: string
}

/** 숫자를 통화 형식으로 변환 */
export const convertToLocale = ({
  amount,
  currency_code,
  minimumFractionDigits,
  maximumFractionDigits,
  locale = "ko-KR",
}: ConvertToLocaleParams): string => {
  return currency_code && !isEmpty(currency_code)
    ? new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currency_code,
        minimumFractionDigits,
        maximumFractionDigits,
      }).format(amount)
    : amount.toString()
}

/** 멤버십 할인 금액 계산 (compare_at_unit_price - unit_price) * quantity */
export const calculateMembershipDiscount = (
  items: HttpTypes.StoreCartLineItem[]
): number => {
  return items.reduce((acc, item) => {
    const compareAtPrice = item.compare_at_unit_price ?? item.unit_price
    const discount = (compareAtPrice - item.unit_price) * item.quantity
    return acc + Math.max(0, discount)
  }, 0)
}

/** 숫자를 천단위 콤마 문자열로 변환 (9000 → "9,000") - 단순 포맷용 */
export const formatPrice = (value: number | null | undefined): string =>
  (value ?? 0).toLocaleString("ko-KR")

/** 할인율 계산 (원가, 할인가) → "30" (30% 할인) */
export const getPercentageDiff = (
  original: number,
  calculated: number
): string => {
  if (!original || original <= calculated) return "0"
  const diff = original - calculated
  const decrease = (diff / original) * 100
  return decrease.toFixed()
}

/** Line Item 가격 정보 (compare_at_unit_price 기준 정가 표시) */
export const calcItemPrice = (item: {
  total?: number | null
  compare_at_unit_price?: number | null
  unit_price: number
  quantity: number
}) => {
  // 주문상품 섹션에서는 멤버십 할인(상품 자체 할인)만 표시
  // item.total은 쿠폰 등 프로모션 할인까지 포함하므로, unit_price * quantity 사용
  const total = item.unit_price * item.quantity
  // 정가: compare_at_unit_price가 있으면 사용, 없으면 unit_price (할인 없음)
  const compareAtTotal = item.compare_at_unit_price
    ? item.compare_at_unit_price * item.quantity
    : null
  const originalTotal = compareAtTotal ?? total
  const hasReducedPrice = originalTotal > total

  return { total, originalTotal, hasReducedPrice }
}

/** Cart Totals 타입 */
export type CartTotalsType = {
  currency_code: string
  total?: number | null
  subtotal?: number | null
  tax_total?: number | null
  item_subtotal?: number | null
  item_total?: number | null
  shipping_subtotal?: number | null
  shipping_total?: number | null
  discount_subtotal?: number | null
  discount_total?: number | null
  original_item_subtotal?: number | null
  original_item_total?: number | null
}

/** Cart Totals 추출 (Medusa에서 계산된 값 그대로 사용) */
export const getCartTotals = (cart: CartTotalsType) => {
  const currency_code = cart.currency_code
  const item_subtotal = cart.item_subtotal ?? cart.item_total ?? 0
  const shipping_subtotal = cart.shipping_subtotal ?? cart.shipping_total ?? 0
  const discount_subtotal = cart.discount_subtotal ?? cart.discount_total ?? 0
  const tax_total = cart.tax_total ?? 0
  const total = cart.total ?? 0
  const original_subtotal =
    cart.original_item_subtotal ??
    cart.original_item_total ??
    item_subtotal + discount_subtotal

  return {
    currency_code,
    item_subtotal,
    shipping_subtotal,
    discount_subtotal,
    tax_total,
    total,
    original_subtotal,
  }
}
