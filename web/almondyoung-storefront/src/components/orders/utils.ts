import type { Order, GroupedOrders } from "./types"

/**
 * 날짜별로 주문을 그룹화하는 유틸리티 함수
 * 단일 책임: 데이터 그룹화만 담당
 */
export function groupOrdersByDate(orders: Order[]): GroupedOrders {
  const grouped: GroupedOrders = {}

  orders.forEach((order) => {
    if (!grouped[order.date]) {
      grouped[order.date] = []
    }
    grouped[order.date].push(order)
  })

  return grouped
}
