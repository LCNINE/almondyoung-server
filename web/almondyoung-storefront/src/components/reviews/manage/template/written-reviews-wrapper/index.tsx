import { getMyReviews } from "@/lib/api/ugc/reviews"
import { getProductsByMasterIds } from "@/lib/api/pim/products"
import { WrittenReviewsSection } from "../../components/written-reviews/written-reviews-section"
import type { WrittenReview } from "../../types"

export async function WrittenReviewsWrapper() {
  const reviewsData = await getMyReviews({ limit: 50 })
  const reviews = reviewsData.data

  if (reviews.length === 0) {
    return <WrittenReviewsSection reviews={[]} />
  }

  const productIds = Array.from(new Set(reviews.map((r) => r.productId)))
  const products = await getProductsByMasterIds(productIds)
  const productMap = new Map(products.map((p) => [p.masterId, p]))

  const writtenReviews: WrittenReview[] = reviews.map((r) => {
    const product = productMap.get(r.productId)
    return {
      id: r.id,
      productId: r.productId,
      productName: product?.name ?? "상품",
      productImage: product?.thumbnail ?? "",
      rating: r.rating,
      content: r.content,
      mediaFileIds: r.mediaFileIds,
      createdAt: r.createdAt,
    }
  })

  return <WrittenReviewsSection reviews={writtenReviews} />
}
