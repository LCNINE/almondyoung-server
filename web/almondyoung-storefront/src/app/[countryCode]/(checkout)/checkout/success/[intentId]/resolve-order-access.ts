interface OrderRef {
  customer_id?: string | null
}

interface CustomerRef {
  id: string
  metadata?: Record<string, unknown> | null
}

export function resolveOrderAccess(
  order: OrderRef | null | undefined,
  customer: CustomerRef | null | undefined
) {
  const isCustomerMatch = Boolean(
    order?.customer_id && customer?.id === order.customer_id
  )
  const almondUserId = customer?.metadata?.["almond_user_id"]
  const hasAlmondUser =
    typeof almondUserId === "string" && almondUserId.trim() !== ""

  return {
    isCustomerMatch,
    canShowSatisfaction: isCustomerMatch && hasAlmondUser,
  }
}
