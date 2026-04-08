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
 * compare_at_unit_price와 unit_price 차이로 멤버십 할인을 계산합니다.
 * unit_price가 이미 정가로 복원되면 compare_at이 남아있어도 할인 = 0이 됩니다.
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
