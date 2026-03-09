import { getOrders } from "@lib/api/medusa/orders"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import ShippingStatusCard from "../../components/mobile/shipping-status-card"
import type { OrderItem, OrderStatus } from "../../types/mypage-types"

/**
 * 배송 상태 카드 Wrapper
 */
export async function ShippingStatusWrapper() {
  const ordersData = await getOrders({ limit: 10 }).catch(() => null)

  const orderList: OrderItem[] = (ordersData?.orders || [])
    .filter((order: any) => {
      const fulfillmentStatus = order.fulfillment_status
      return (
        fulfillmentStatus === "partially_fulfilled" ||
        fulfillmentStatus === "fulfilled" ||
        fulfillmentStatus === "shipped" ||
        fulfillmentStatus === "not_fulfilled"
      )
    })
    .slice(0, 2)
    .map((order: any) => {
      const fulfillmentStatus = order.fulfillment_status
      let status: OrderStatus = "PREPARING"
      let statusLabel = "상품 준비 중"

      if (
        fulfillmentStatus === "shipped" ||
        fulfillmentStatus === "fulfilled"
      ) {
        status = "SHIPPING"
        statusLabel = "배송 중"
      } else if (fulfillmentStatus === "partially_fulfilled") {
        status = "SHIPPING"
        statusLabel = "부분 배송 중"
      }

      const thumbnail =
        order.items?.[0]?.thumbnail ||
        order.items?.[0]?.variant?.product?.thumbnail ||
        "https://placehold.co/44x45"
      const thumbnailUrl = getThumbnailUrl(thumbnail)

      return {
        id: order.id,
        orderNumber: order.display_id?.toString() || order.id.slice(0, 12),
        status,
        statusLabel,
        thumbnailUrl,
      }
    })

  return <ShippingStatusCard initialOrders={orderList} />
}
