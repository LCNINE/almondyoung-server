import { ReviewPreviewCarousel } from "@/components/reviews/preview/review-preview-carousel"
import { getRatingSummary, getReviewsByProductId } from "@/lib/api/ugc/reviews"
import type { RatingSummary } from "@/lib/types/ui/ugc"

const PREVIEW_LIMIT = 12

interface Props {
  /** PIM 마스터 id. 없으면 리뷰가 존재할 수 없으므로 조회 자체를 하지 않는다 */
  productId: string | undefined
}

export async function ReviewPreviewWrapper({ productId }: Props) {
  if (!productId) return null

  const [ratingSummary, reviewResult] = await Promise.all([
    getRatingSummary(productId).catch((): RatingSummary | null => null),
    getReviewsByProductId({
      productId,
      sort: "latest",
      page: 1,
      limit: PREVIEW_LIMIT,
    }).catch(() => ({ data: [], total: 0, page: 1, limit: PREVIEW_LIMIT })),
  ])

  const reviews = (reviewResult.data ?? []).filter(
    (review) => review.status === "active"
  )

  if (!reviews.length) return null

  return (
    <ReviewPreviewCarousel reviews={reviews} ratingSummary={ratingSummary} />
  )
}
