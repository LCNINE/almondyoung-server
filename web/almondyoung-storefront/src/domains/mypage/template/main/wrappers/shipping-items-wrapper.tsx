import { getOrders } from "@lib/api/medusa/orders"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import { ShippingItemsSection } from "../../../components/desktop/shipping-items-section"
import type { ShippingOrder } from "../../../types/mypage-types"
import { resolveMypageShippingStatus } from "./mypage-order-status"

/**
 * 배송 중 상품 Wrapper
 */
export async function ShippingItemsWrapper() {
  const ordersData = await getOrders({ limit: 10 }).catch(() => null)

  const shippingOrders: ShippingOrder[] = (ordersData?.orders || [])
    .filter((order: any) => order.status !== "canceled")
    .map((order: any) => {
      const shippingStatus = resolveMypageShippingStatus(order)
      if (!shippingStatus) {
        return null
      }

      let deliveryInfo = ""

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
        status: shippingStatus.statusLabel,
        paymentStatus: order.payment_status ?? "unknown",
        deliveryInfo,
        shippingNote: "",
        productName,
        productImage: getThumbnailUrl(productImage),
        price,
        quantity: order.items?.length || 0,
        options,
        showInquiry: false,
        orderItems: (order.items ?? [])
          .filter(
            (item: any) => item.variant?.product?.handle || item.product_handle
          )
          .map((item: any) => ({
            productId: item.variant?.product?.handle ?? item.product_handle,
            orderLineId: item.id,
          })),
        variantId: firstItem?.variant_id ?? "",
      }
    })
    .filter((order): order is ShippingOrder => order !== null)
    .slice(0, 3)

  return <ShippingItemsSection initialOrders={shippingOrders} />
}
