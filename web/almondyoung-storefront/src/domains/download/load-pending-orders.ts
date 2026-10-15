import { getOrders } from "@/lib/api/medusa/orders"
import {
  getGrantedLibraryOrderIds,
  getOwnerships,
} from "@/lib/api/library/library-api"
import {
  getPaidDigitalOrders,
  getPendingDigitalOrders,
  type PendingDigitalOrder,
} from "./pending-orders"

export type PendingOrdersResult = {
  orders: PendingDigitalOrder[]
  unavailable: boolean
}

export async function loadPendingOrders(): Promise<PendingOrdersResult> {
  try {
    // 한 번의 주문 조회와 한 번의 배치 권한 조회만 수행한다. 시간 경과로 미반영 항목을 숨기지 않는다.
    const result = await getOrders({
      limit: 100,
      fields:
        "id,display_id,status,payment_status,created_at,metadata,*items,+items.requires_shipping,+items.product_type",
    })

    if (!result) return { orders: [], unavailable: true }

    const paidOrders = getPaidDigitalOrders(result.orders)

    if (paidOrders.length === 0) return { orders: [], unavailable: false }

    const grantedOrderIds = await getGrantedLibraryOrderIds(
      paidOrders.map((order) => order.id)
    )

    return {
      orders: getPendingDigitalOrders(paidOrders, grantedOrderIds),
      unavailable: false,
    }
  } catch {
    // 보조 조회 실패로 기존 라이브러리를 가리거나, 미반영 상태라고 단정하지 않는다.
    return { orders: [], unavailable: true }
  }
}

export async function loadDownloadData(
  options: Parameters<typeof getOwnerships>[0]
) {
  // 반영 상태를 확인한 뒤 목록을 읽어, 조회 도중 grant 된 상품이 양쪽에서 사라지는 레이스를 막는다.
  const pendingOrders = await loadPendingOrders()
  const ownerships = await getOwnerships(options)

  return { ownerships, pendingOrders }
}
