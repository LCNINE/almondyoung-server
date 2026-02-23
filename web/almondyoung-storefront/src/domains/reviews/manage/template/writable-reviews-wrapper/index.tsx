import { getOrders } from "@lib/api/medusa/orders"
import { WritableReviewsSection } from "../../components/writable-reviews/writable-reviews-section"
import type { WritableReview } from "../../types"

export async function WritableReviewsWrapper() {
  const ordersData = await getOrders({ limit: 50, status: "completed" })
  const writableReviews: WritableReview[] =
    ordersData?.orders?.flatMap(
      (order) =>
        order.items?.map((item) => ({
          id: item.id,
          orderId: order.id,
          productId: item.variant?.product_id || item.product_id || "",
          productName: item.title || item.variant?.product?.title || "상품",
          productImage:
            item.thumbnail ||
            item.variant?.product?.thumbnail ||
            "https://placehold.co/80x80",
          orderDate: String(order.updated_at || ""),
          variantTitle: item.variant?.title || "",
        })) ?? []
    ) ?? []

  return <WritableReviewsSection reviews={writableReviews} />
}
