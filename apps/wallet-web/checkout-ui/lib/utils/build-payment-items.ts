import type { HttpTypes } from "@medusajs/types"

export interface PaymentItemDiscount {
  kind: "ITEM_PER_UNIT" | "ITEM_FLAT"
  amount: number
  discountRefId: string
  name?: string
}

export interface PaymentItem {
  lineId: string
  name: string
  itemType: "PRODUCT" | "SHIPPING_FEE"
  itemRefId?: string
  unitPrice: number
  quantity: number
  discounts?: PaymentItemDiscount[]
}

export function buildPaymentItems(
  cartItems: HttpTypes.StoreCartLineItem[],
  shippingMethods?: HttpTypes.StoreCartShippingMethod[]
): PaymentItem[] {
  const items: PaymentItem[] = []

  for (const item of cartItems) {
    const compareAt = item.compare_at_unit_price ?? item.unit_price
    const unitPrice =
      compareAt > item.unit_price ? compareAt : item.unit_price

    const discounts: PaymentItemDiscount[] = []

    // 멤버십 할인: compare_at > unit_price일 때만
    if (compareAt > item.unit_price) {
      discounts.push({
        kind: "ITEM_PER_UNIT",
        amount: compareAt - item.unit_price,
        discountRefId: "membership",
        name: "멤버십 할인",
      })
    }

    // 프로모션 할인: adjustments
    if (item.adjustments) {
      for (const adj of item.adjustments) {
        if (!adj.amount || adj.amount <= 0) continue
        discounts.push({
          kind: "ITEM_FLAT",
          amount: adj.amount,
          discountRefId: adj.code ?? adj.id,
        })
      }
    }

    items.push({
      lineId: item.id,
      name: item.product_title ?? item.title,
      itemType: "PRODUCT",
      itemRefId: item.variant_id ?? undefined,
      unitPrice,
      quantity: item.quantity,
      ...(discounts.length > 0 ? { discounts } : {}),
    })
  }

  // 배송비
  if (shippingMethods) {
    for (const shipping of shippingMethods) {
      const discounts: PaymentItemDiscount[] = []

      if (shipping.adjustments) {
        for (const adj of shipping.adjustments) {
          if (!adj.amount || adj.amount <= 0) continue
          discounts.push({
            kind: "ITEM_FLAT",
            amount: adj.amount,
            discountRefId: adj.code ?? adj.id,
          })
        }
      }

      items.push({
        lineId: shipping.id,
        name: shipping.name ?? "배송비",
        itemType: "SHIPPING_FEE",
        unitPrice: shipping.amount,
        quantity: 1,
        ...(discounts.length > 0 ? { discounts } : {}),
      })
    }
  }

  return items
}
