import type { AddToDeliveryLink } from "@lib/api/medusa/add-to-delivery"
import type { StoreOrderActionsResponse } from "@/lib/api/orders/store-orders"

type TogetherGroup<T extends { orderId: string }> = { parent: T; children: T[] }

/**
 * 한 페이지 안에서 출고 전 부모 아래로 함께 배송 주문을 모은다. 부모가 이 페이지에 없거나 취소됐으면 자식은 혼자 그린다.
 * ponytail: 페이지(5건) 경계에서 갈리면 묶지 않는다. 필요해지면 links 로 부모를 따로 불러 붙인다.
 */
export function groupForTogetherDelivery<T extends { orderId: string }>(
  orders: T[],
  linksMap: Record<string, AddToDeliveryLink>,
  actionsMap: Record<string, StoreOrderActionsResponse>
): TogetherGroup<T>[] {
  const inPage = new Map(orders.map((o) => [o.orderId, o]))
  const parentOf = (o: T) => {
    const link = linksMap[o.orderId]
    const parentId = link?.parentOrderId
    if (!parentId || link.parentCanceled || !inPage.has(parentId)) return null
    if (isCanceledOrder(actionsMap[parentId]) || isCanceledOrder(actionsMap[o.orderId])) return null

    return parentId
  }

  const groups = new Map<string, TogetherGroup<T>>()

  for (const order of orders) {
    const parentId = parentOf(order)

    if (parentId) {
      const group = groups.get(parentId) ?? { parent: inPage.get(parentId)!, children: [] }
      group.children.push(order)
      groups.set(parentId, group)
    } else if (!groups.has(order.orderId)) {
      groups.set(order.orderId, { parent: order, children: [] })
    }
  }

  return orders
    .filter((o) => groups.has(o.orderId))
    .map((o) => groups.get(o.orderId)!)
}

/** 출고 전 부모에 살아 있는 함께 배송 주문이 있으면 부모 취소 창에 넘길 정보 */
export function parentCancelInfo(
  link: AddToDeliveryLink | undefined,
  actions: StoreOrderActionsResponse | undefined
): { withheldAmount: number; childOrderIds: string[] } | undefined {
  if (!link || link.parentOrderId || link.children.length === 0) return undefined
  if (isCanceledOrder(actions)) return undefined

  return { withheldAmount: link.withheldAmount, childOrderIds: link.children }
}

export function isCanceledOrder(actions: StoreOrderActionsResponse | undefined): boolean {
  return actions?.orderStatus === "cancelled"
}
