import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { getMyReviews } from "@/lib/api/ugc/reviews"
import { notFound } from "next/navigation"
import { WrittenReviewsSection } from "../../components/written-reviews/written-reviews-section"
import type { WrittenReview } from "../../types"
import {
  REVIEW_PERIOD_OPTIONS,
  REVIEW_TYPE_OPTIONS,
  type ReviewPeriod,
  type ReviewType,
} from "../../utils/constants"

export async function WrittenReviewsWrapper(props: {
  params: { countryCode: string }
  searchParams: { period?: string; type?: string }
}) {
  const { period: periodParam, type: typeParam } = props.searchParams

  // 기본값: 6개월, 전체
  const period = (periodParam ?? REVIEW_PERIOD_OPTIONS.SIX_MONTHS) as ReviewPeriod
  const type = (typeParam ?? REVIEW_TYPE_OPTIONS.ALL) as ReviewType

  const reviewsData = await getMyReviews({ period, type, limit: 50 })
  const reviews = reviewsData.data

  if (reviews.length === 0) {
    return (
      <WrittenReviewsSection
        reviews={[]}
        totalCount={reviewsData.total}
        period={period}
        type={type}
      />
    )
  }

  const region = await getRegion(props.params.countryCode)

  if (!region) {
    notFound()
  }

  // 중복 제거 후 상품 정보 batch 조회
  const productIds = Array.from(new Set(reviews.map((r) => r.productId)))
  const products = await listProducts({
    queryParams: { handle: productIds },
    regionId: region.id,
  }).then(({ response }) => response.products)

  const productMap = new Map(products.map((p) => [p.handle, p]))

  const writtenReviews: WrittenReview[] = reviews.map((r) => {
    const product = productMap.get(r.productId)
    return {
      id: r.id,
      productId: r.productId,
      productName: product?.title ?? "상품",
      productImage: product?.thumbnail ?? "",
      rating: r.rating,
      content: r.content,
      mediaFileIds: r.mediaFileIds,
      createdAt: r.createdAt,
    }
  })

  return (
    <WrittenReviewsSection
      reviews={writtenReviews}
      totalCount={reviewsData.total}
      period={period}
      type={type}
    />
  )
}
