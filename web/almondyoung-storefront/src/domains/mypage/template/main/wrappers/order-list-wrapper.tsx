import { OrderList } from "@/domains/order/list/order-list"
import {
  getOrderActionsByMedusaId,
  type StoreOrderActionsResponse,
} from "@/lib/api/orders/store-orders"
import { getOrders } from "@lib/api/medusa/orders"
import { withMypageTimeout } from "./mypage-timeout"

/** 클라 페이지네이션용 로드 상한 (OrderList 의 FETCH_LIMIT 과 동일 기준) */
const HOME_ORDER_LIMIT = 100
/** SSR Core 액션 조회는 첫 페이지분만(나머지는 클라에서 페이지 이동 시 조회) */
const SSR_ACTIONS_COUNT = 8

/**
 * 마이페이지 홈(데스크탑)에 임베드되는 주문목록 wrapper.
 * order/list 페이지와 동일한 데이터를 받아 OrderList 를 embedded 모드로 렌더한다.
 */
export async function OrderListWrapper() {
  const ordersData = await withMypageTimeout(
    getOrders({ limit: HOME_ORDER_LIMIT, offset: 0 }),
    null
  )
  const orders = ordersData?.orders ?? []

  const actionsResults = await Promise.allSettled(
    orders
      .slice(0, SSR_ACTIONS_COUNT)
      .map((o) => getOrderActionsByMedusaId(o.id))
  )
  const actionsMap: Record<string, StoreOrderActionsResponse> = {}
  actionsResults.forEach((result, idx) => {
    if (result.status === "fulfilled" && orders[idx]) {
      actionsMap[orders[idx]!.id] = result.value
    }
  })

  return (
    <OrderList
      initialOrders={orders}
      initialCount={ordersData?.count ?? 0}
      initialLimit={HOME_ORDER_LIMIT}
      hasError={ordersData === null}
      initialActionsMap={actionsMap}
      embedded
    />
  )
}
