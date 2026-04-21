import { getOrders } from "@lib/api/medusa/orders"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import ShippingStatusCard from "../../../components/mobile/shipping-status-card"
import type { OrderItem } from "../../../types/mypage-types"
import { resolveMypageShippingStatus } from "./mypage-order-status"

/**
 * 배송 상태 카드 Wrapper
 */
export async function ShippingStatusWrapper() {
  const ordersData = await getOrders({ limit: 10 }).catch(() => null)

  const orderList: OrderItem[] = (ordersData?.orders || [])
    .filter((order: any) => order.status !== "canceled")
    .map((order: any) => {
      const shippingStatus = resolveMypageShippingStatus(order)
      if (!shippingStatus) {
        return null
      }

      const thumbnail =
        order.items?.[0]?.thumbnail ||
        order.items?.[0]?.variant?.product?.thumbnail ||
        "https://placehold.co/44x45"
      const thumbnailUrl = getThumbnailUrl(thumbnail)

      return {
        id: order.id,
        orderNumber: order.display_id?.toString() || order.id.slice(0, 12),
        status: shippingStatus.status,
        statusLabel: shippingStatus.statusLabel,
        thumbnailUrl,
      }
    })
    .filter((order): order is OrderItem => order !== null)
    .slice(0, 2)

  return <ShippingStatusCard initialOrders={orderList} />
}
