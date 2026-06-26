import type { HttpTypes } from "@medusajs/types"
import { cartRequiresShipping } from "@/lib/api/medusa/shipping-method-policy"

export type CartSummaryTotalsPreview = {
  currency_code: string
  item_subtotal: number | null
  discount_total: number | null
  shipping_total: number | null
  total: number | null
  items: HttpTypes.StoreCartLineItem[]
}

/** 장바구니 사이드바에서 선택된 상품들만 기준으로 금액 요약을 계산한다. */
export function buildCartSummaryTotals(
  cart: HttpTypes.StoreCart & { promotions?: HttpTypes.StorePromotion[] },
  selectedIds: Set<string>
): CartSummaryTotalsPreview {
  const currency_code = cart.currency_code
  const allItems = cart.items ?? []
  const selectedItems = allItems.filter((item) => selectedIds.has(item.id))

  if (selectedItems.length === 0) {
    return {
      currency_code,
      item_subtotal: null,
      discount_total: null,
      shipping_total: null,
      total: null,
      items: [],
    }
  }

  // 총 상품 가격: unit_price × quantity 합
  // 할인 금액: unit_price 기준 금액과 item.subtotal(프로모션/쿠폰 반영 값)의 차이만 사용
  const itemSubtotal = selectedItems.reduce((acc, item) => {
    return acc + (item.unit_price ?? 0) * (item.quantity ?? 0)
  }, 0)

  const couponDiscountTotal = selectedItems.reduce((acc, item) => {
    const qty = item.quantity ?? 0
    const originalPrice = (item.unit_price ?? 0) * qty
    const discountedPrice = item.subtotal ?? originalPrice
    return acc + Math.max(0, originalPrice - discountedPrice)
  }, 0)

  // CartTotals에서는 items를 보고 멤버십 할인 금액을 따로 보여주고
  // 여기 total은 쿠폰/프로모션 할인(couponDiscountTotal)만 반영해서 계산
  //
  // 배송비는 '선택된 상품' 기준으로 산출한다. 디지털-only 부분 선택이면 실제 체크아웃이 배송비를
  // 0으로 제거(clearCartShippingMethods)하므로 프리뷰도 0이어야 커밋 화면과 금액이 일치한다.
  // requires_shipping/product_type 는 이미 로드된 라인아이템 값이라 추가 호출/지연이 없다.
  const shipping = cartRequiresShipping(selectedItems)
    ? (cart.shipping_total ?? 0)
    : 0

  const total = Math.max(0, Math.round(itemSubtotal + shipping - couponDiscountTotal))

  return {
    currency_code,
    item_subtotal: Math.round(itemSubtotal),
    discount_total: couponDiscountTotal > 0 ? Math.round(couponDiscountTotal) : null,
    shipping_total: shipping,
    total,
    items: selectedItems,
  }
}
