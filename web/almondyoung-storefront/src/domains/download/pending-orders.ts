import {
  isDigitalItem,
  type CartShippingPolicyItem,
} from "@/lib/api/medusa/shipping-method-policy"

export type DigitalOrderInput = {
  id: string
  display_id?: number | null
  created_at?: string | Date | null
  status?: string
  payment_status?: string
  metadata?: Record<string, unknown> | null
  items?: Array<
    CartShippingPolicyItem & {
      id: string
      title?: string | null
      thumbnail?: string | null
    }
  > | null
}

export type PendingDigitalOrder = Omit<DigitalOrderInput, "items"> & {
  items: NonNullable<DigitalOrderInput["items"]>
}

export function getPaidDigitalOrders(
  orders: DigitalOrderInput[]
): PendingDigitalOrder[] {
  return orders.flatMap((order) => {
    if (
      order.payment_status !== "captured" ||
      order.status === "canceled" ||
      order.metadata?.refund_status === "requested"
    ) {
      return []
    }

    const items = (order.items ?? []).filter(isDigitalItem)

    return items.length > 0 ? [{ ...order, items }] : []
  })
}

export function getPendingDigitalOrders(
  orders: PendingDigitalOrder[],
  grantedOrderIds: string[]
): PendingDigitalOrder[] {
  const granted = new Set(grantedOrderIds)

  return orders.filter((order) => !granted.has(order.id))
}
