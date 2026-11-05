import { splitLineDiscount } from "@/lib/utils/quantity-discount"

type Metadata = Record<string, unknown> | null | undefined

type CartItem = {
  quantity: number
  unit_price: number
  compare_at_unit_price?: number | null
  variant?: { metadata?: Metadata } | null
  product?: { metadata?: Metadata } | null
}

type DiscountResult = {
  originalTotal: number
  /** 정가 − 단가 중 수량 할인을 뺀 몫(멤버십가·세일) */
  membershipDiscount: number
  quantityDiscount: number
  itemCount: number
}

export type CartDiscountContext<T extends CartItem = CartItem> = {
  isMember: boolean
  isTimeSaleLine: (item: T) => boolean
  now: Date
}

/**
 * 할인 = compare_at_unit_price - unit_price.
 * metadata.membershipPrice 방식은 해지 후에도 할인이 남는 버그가 있어서 변경함.
 * context 를 주면 그중 수량 할인 몫을 따로 센다(같은 옵션 N개 이상 구간가).
 */
export function calculateCartDiscount<T extends CartItem>(
  items: T[] | undefined,
  context?: CartDiscountContext<T>
): DiscountResult {
  const itemList = items ?? []

  const itemCount = itemList.reduce((acc, item) => acc + item.quantity, 0)

  const originalTotal = itemList.reduce((acc, item) => {
    const price = item.compare_at_unit_price ?? item.unit_price
    return acc + price * item.quantity
  }, 0)

  let membershipDiscount = 0
  let quantityDiscount = 0
  for (const item of itemList) {
    const compareAt = item.compare_at_unit_price
    if (compareAt == null || compareAt <= item.unit_price) continue
    if (!context) {
      membershipDiscount += (compareAt - item.unit_price) * item.quantity
      continue
    }
    const split = splitLineDiscount(item, {
      isMember: context.isMember,
      isTimeSale: context.isTimeSaleLine(item),
      now: context.now,
    })
    membershipDiscount += split.otherDiscount
    quantityDiscount += split.quantityDiscount
  }

  return {
    originalTotal,
    membershipDiscount,
    quantityDiscount,
    itemCount,
  }
}
