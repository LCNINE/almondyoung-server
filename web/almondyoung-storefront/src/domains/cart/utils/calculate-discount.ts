import { HttpTypes } from "@medusajs/types"

type CartItem = {
  quantity: number
  compare_at_unit_price?: number | null
  variant?: {
    metadata?: {
      membershipPrice?: number
    } | null
  } | null
}

type DiscountResult = {
  originalTotal: number // 정가 합계
  membershipDiscount: number // 멤버십 할인 금액
  itemCount: number // 총 상품 수량
}

/**
 * 카트의 할인 정보를 계산합니다.
 * - originalTotal: 정가 합계 (compare_at_unit_price 기준)
 * - membershipDiscount: 멤버십 할인 금액 (정가 - 멤버십가)
 * - itemCount: 총 상품 수량
 */
export function calculateCartDiscount(
  items: CartItem[] | HttpTypes.StoreCartLineItem[] | undefined
): DiscountResult {
  const itemList = items ?? []

  const itemCount = itemList.reduce((acc, item) => acc + item.quantity, 0)

  // 정가 합계 계산 (compare_at_unit_price 기준)
  const originalTotal = itemList.reduce((acc, item) => {
    const compareAt = item.compare_at_unit_price ?? 0
    return acc + compareAt * item.quantity
  }, 0)

  // 멤버십 할인 금액 계산 (정가 - 멤버십가)
  const membershipDiscount = itemList.reduce((acc, item) => {
    const compareAt = item.compare_at_unit_price
    const membershipPrice = item.variant?.metadata?.membershipPrice as
      | number
      | undefined

    if (compareAt && membershipPrice && compareAt > membershipPrice) {
      return acc + (compareAt - membershipPrice) * item.quantity
    }
    return acc
  }, 0)

  return {
    originalTotal,
    membershipDiscount,
    itemCount,
  }
}
