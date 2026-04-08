import { HttpTypes } from "@medusajs/types"

type CartItem = {
  quantity: number
  unit_price: number
  compare_at_unit_price?: number | null
}

type DiscountResult = {
  originalTotal: number
  membershipDiscount: number
  itemCount: number
}

/**
 * 멤버십 할인 = compare_at_unit_price - unit_price.
 * metadata.membershipPrice 방식은 해지 후에도 할인이 남는 버그가 있어서 변경함.
 */
export function calculateCartDiscount(
  items: CartItem[] | HttpTypes.StoreCartLineItem[] | undefined
): DiscountResult {
  const itemList = items ?? []

  const itemCount = itemList.reduce((acc, item) => acc + item.quantity, 0)

  const originalTotal = itemList.reduce((acc, item) => {
    const price = item.compare_at_unit_price ?? item.unit_price
    return acc + price * item.quantity
  }, 0)

  const membershipDiscount = itemList.reduce((acc, item) => {
    const compareAt = item.compare_at_unit_price
    if (compareAt != null && compareAt > item.unit_price) {
      return acc + (compareAt - item.unit_price) * item.quantity
    }
    return acc
  }, 0)

  return {
    originalTotal,
    membershipDiscount,
    itemCount,
  }
}
