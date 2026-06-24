import { getOrders } from "@lib/api/medusa/orders"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import ShippingStatusCard from "../../../components/mobile/shipping-status-card"
import type { OrderItem } from "../../../types/mypage-types"
import {
  resolveMypageDisplayLabel,
  resolveMypageShippingStatus,
} from "./mypage-order-status"
import { withMypageTimeout } from "./mypage-timeout"

/**
 * 배송 상태 카드 Wrapper
 */
export async function ShippingStatusWrapper() {
  const ordersData = await withMypageTimeout(getOrders({ limit: 10 }), null)

  // 1) 표시 대상 주문 선별(기존 로직 유지) → 2) 선별된 주문만 Core 상태 조회해 실제 라벨 계산
  const candidates = (ordersData?.orders || [])
    .filter((order: any) => order.status !== "canceled")
    .map((order: any) => ({
      order,
      shippingStatus: resolveMypageShippingStatus(order),
    }))
    .filter((c: any) => c.shippingStatus !== null)
    .slice(0, 2)

  const orderList: OrderItem[] = await Promise.all(
    candidates.map(async ({ order, shippingStatus }: any) => {
      const statusLabel = await resolveMypageDisplayLabel(
        order,
        shippingStatus.statusLabel
      )

      const thumbnail =
        order.items?.[0]?.thumbnail ||
        order.items?.[0]?.variant?.product?.thumbnail ||
        "https://placehold.co/44x45"

      return {
        id: order.id,
        orderNumber: order.display_id?.toString() || order.id.slice(0, 12),
        status: shippingStatus.status,
        statusLabel,
        thumbnailUrl: getThumbnailUrl(thumbnail),
      }
    })
  )

  return <ShippingStatusCard initialOrders={orderList} />
}
