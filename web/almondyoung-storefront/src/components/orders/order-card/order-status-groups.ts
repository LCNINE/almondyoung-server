import type { OrderSummaryItem } from "./order-summary-items"

export interface OrderStatusGroup {
  key: string
  status: string
  hint?: string
  isOrderStatus: boolean
  items: OrderSummaryItem[]
}

export function groupOrderItems(
  items: OrderSummaryItem[],
  status: string,
  deliveryInfo?: string
): OrderStatusGroup[] {
  const groups = new Map<string, OrderStatusGroup>()

  for (const item of items) {
    const isOrderStatus = !item.statusLabel
    const key = isOrderStatus ? "order" : `return:${item.statusLabel}`
    const group = groups.get(key)

    if (group) {
      group.items.push(item)

      if (group.hint !== item.statusHint && !isOrderStatus) {
        group.hint = undefined
      }
    } else {
      groups.set(key, {
        key,
        status: item.statusLabel ?? status,
        hint: isOrderStatus ? deliveryInfo : item.statusHint,
        isOrderStatus,
        items: [item],
      })
    }
  }

  return Array.from(groups.values())
}
