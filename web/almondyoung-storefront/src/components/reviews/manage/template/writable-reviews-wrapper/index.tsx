import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import {
  getReviewEligibilities,
  getRewardPolicies,
} from "@/lib/api/ugc/reviews"
import { notFound } from "next/navigation"
import { WritableReviewsSection } from "../../components/writable-reviews/writable-reviews-section"
import { WritableReview } from "../../types"

const ITEMS_PER_PAGE = 10

export async function WritableReviewsWrapper(props: {
  params: { countryCode: string }
  searchParams: { page?: string }
}) {
  const { page: pageParam } = props.searchParams
  const page = Math.max(1, Number(pageParam) || 1)

  const [eligibilityData, rewardPolicies] = await Promise.all([
    getReviewEligibilities({ page, limit: ITEMS_PER_PAGE }),
    getRewardPolicies(),
  ])

  const eligibilities = eligibilityData?.data ?? []
  const totalPages = Math.ceil((eligibilityData?.total ?? 0) / ITEMS_PER_PAGE)

  if (eligibilities.length === 0) {
    return (
      <WritableReviewsSection
        reviews={[]}
        totalCount={eligibilityData?.total ?? 0}
        currentPage={page}
        totalPages={totalPages}
        rewardPolicies={rewardPolicies}
      />
    )
  }

  const region = await getRegion(props.params.countryCode)

  if (!region) {
    notFound()
  }

  // 중복 제거 후 상품 정보 batch 조회
  const productIds = Array.from(new Set(eligibilities.map((e) => e.productId)))
  const products = await listProducts({
    queryParams: { handle: productIds },
    regionId: region.id,
  }).then(({ response }) => response.products ?? [])

  const productMap = new Map(products.map((p) => [p.handle, p]))
  // eligibility + product merge
  const writableReviews: WritableReview[] = eligibilities.map((e) => {
    const product = productMap.get(e.productId)

    return {
      id: e.id,
      orderId: e.orderId,
      orderLineId: e.orderLineId,
      productId: e.productId,
      productName: product?.title ?? "상품",
      productImage: product?.thumbnail ?? "",
      eligibleAt: e.eligibleAt,
      expiresAt: e.expiresAt,
    }
  })

  return (
    <WritableReviewsSection
      reviews={writableReviews}
      totalCount={eligibilityData.total}
      currentPage={page}
      totalPages={totalPages}
      rewardPolicies={rewardPolicies}
    />
  )
}
