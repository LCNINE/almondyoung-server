import {
  getReviewEligibilities,
  getRewardPolicies,
} from "@/lib/api/ugc/reviews"
import { getProductsByMasterIds } from "@/lib/api/pim/products"
import { WritableReviewsSection } from "../../components/writable-reviews/writable-reviews-section"
import type { WritableReview } from "../../types"

export async function WritableReviewsWrapper() {
  const [eligibilityData, rewardPolicies] = await Promise.all([
    getReviewEligibilities({ limit: 50 }),
    getRewardPolicies(),
  ])

  const eligibilities = eligibilityData.data

  if (eligibilities.length === 0) {
    return (
      <WritableReviewsSection reviews={[]} rewardPolicies={rewardPolicies} />
    )
  }

  // 중복 제거 후 상품 정보 batch 조회
  const productIds = Array.from(new Set(eligibilities.map((e) => e.productId)))
  const products = await getProductsByMasterIds(productIds)
  const productMap = new Map(products.map((p) => [p.masterId, p]))

  // eligibility + product merge
  const writableReviews: WritableReview[] = eligibilities.map((e) => {
    const product = productMap.get(e.productId)
    return {
      id: e.id,
      orderId: e.orderId,
      orderLineId: e.orderLineId,
      productId: e.productId,
      productName: product?.name ?? "상품",
      productImage: product?.thumbnail ?? "",
      eligibleAt: e.eligibleAt,
    }
  })

  return (
    <WritableReviewsSection
      reviews={writableReviews}
      rewardPolicies={rewardPolicies}
    />
  )
}
