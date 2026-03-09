import { getOrders } from "@lib/api/medusa/orders"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import { ShippingItemsSection } from "../../components/desktop/shipping-items-section"
import type { ShippingOrder } from "../../types/mypage-types"

/**
 * 배송 중 상품 Wrapper
 */
export async function ShippingItemsWrapper() {
  const ordersData = await getOrders({ limit: 10 }).catch(() => null)

  const shippingOrders: ShippingOrder[] = (ordersData?.orders || [])
    .filter((order: any) => {
      const fulfillmentStatus = order.fulfillment_status
      return (
        fulfillmentStatus === "partially_fulfilled" ||
        fulfillmentStatus === "fulfilled" ||
        fulfillmentStatus === "shipped" ||
        fulfillmentStatus === "not_fulfilled"
      )
    })
    .slice(0, 3)
    .map((order: any) => {
      const fulfillmentStatus = order.fulfillment_status
      let status = "상품 준비 중"
      let deliveryInfo = ""

      if (
        fulfillmentStatus === "shipped" ||
        fulfillmentStatus === "fulfilled"
      ) {
        status = "배송 중"
      } else if (fulfillmentStatus === "partially_fulfilled") {
        status = "부분 배송 중"
      }

      const firstItem = order.items?.[0]
      const productName =
        firstItem?.title || firstItem?.variant?.product?.title || "상품"
      const productImage =
        firstItem?.thumbnail ||
        firstItem?.variant?.product?.thumbnail ||
        "https://placehold.co/80x80"
      const displayPrice = typeof order.total === "number" ? order.total : 0
      const price = `${displayPrice.toLocaleString()}원`

      const options: string[] = []
      if (firstItem?.variant?.title && firstItem.variant.title !== "Default") {
        options.push(firstItem.variant.title)
      }

      return {
        orderId: order.id,
        status,
        paymentStatus: order.payment_status ?? "unknown",
        deliveryInfo,
        shippingNote: "",
        productName,
        productImage: getThumbnailUrl(productImage),
        price,
        quantity: order.items?.length || 0,
        options,
        showInquiry: status === "배송 완료",
        orderItems: (order.items ?? [])
          .filter(
            (item: any) => item.variant?.product?.handle || item.product_handle
          )
          .map((item: any) => ({
            productId: item.variant?.product?.handle ?? item.product_handle,
            orderLineId: item.id,
          })),
      }
    })

  return <ShippingItemsSection initialOrders={shippingOrders} />
}
