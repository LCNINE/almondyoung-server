import { getOrders } from "@lib/api/medusa/orders"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import { ShippingItemsSection } from "../../../components/desktop/shipping-items-section"
import type { ShippingOrder } from "../../../types/mypage-types"
import {
  resolveMypageDisplayLabel,
  resolveMypageShippingStatus,
} from "./mypage-order-status"
import { withMypageTimeout } from "./mypage-timeout"

/**
 * 배송 중 상품 Wrapper
 */
export async function ShippingItemsWrapper() {
  const ordersData = await withMypageTimeout(getOrders({ limit: 10 }), null)

  // 1) 표시 대상 주문 선별(기존 로직 유지) → 2) 선별된 주문만 Core 상태 조회해 실제 라벨 계산
  const candidates = (ordersData?.orders || [])
    .filter((order: any) => order.status !== "canceled")
    .map((order: any) => ({
      order,
      shippingStatus: resolveMypageShippingStatus(order),
    }))
    .filter((c: any) => c.shippingStatus !== null)
    .slice(0, 3)

  const shippingOrders: ShippingOrder[] = await Promise.all(
    candidates.map(async ({ order, shippingStatus }: any) => {
      const statusLabel = await resolveMypageDisplayLabel(
        order,
        shippingStatus.statusLabel
      )

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
        status: statusLabel,
        paymentStatus: order.payment_status ?? "unknown",
        deliveryInfo: "",
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
        bankTransferStatus:
          ((order.metadata as Record<string, unknown> | null)
            ?.bank_transfer_status as string | undefined) ?? undefined,
      }
    })
  )

  return <ShippingItemsSection initialOrders={shippingOrders} />
}
