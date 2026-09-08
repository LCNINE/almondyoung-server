import { ReviewDetailCardList } from "@/components/reviews/details/review-detail-card-list"
import { getRatingSummary, getReviewsByProductId } from "@/lib/api/ugc/reviews"
import type { ReviewSortOption } from "@/lib/types/common/filter"
import type { RatingSummary } from "@/lib/types/ui/ugc"

const ITEMS_PER_PAGE = 10

interface Props {
  /** PIM 마스터 id. 없으면 리뷰가 존재할 수 없으므로 조회 없이 빈 목록을 그린다 */
  productId: string | undefined
  countryCode: string
}

export async function ReviewSectionWrapper({ productId, countryCode }: Props) {
  if (!productId) {
    return (
      <ReviewDetailCardList
        countryCode={countryCode}
        productId={undefined}
        totalReviews={0}
        averageRating={0}
        initialReviews={[]}
      />
    )
  }

  const [ratingSummary, reviewResult] = await Promise.all([
    getRatingSummary(productId).catch((): RatingSummary | null => null),
    getReviewsByProductId({
      productId,
      sort: "latest" satisfies ReviewSortOption,
      page: 1,
      limit: ITEMS_PER_PAGE,
    }).catch(() => ({ data: [], total: 0, page: 1, limit: ITEMS_PER_PAGE })),
  ])

  const initialReviews = (reviewResult.data ?? []).filter(
    (review) => review.status === "active"
  )

  return (
    <ReviewDetailCardList
      countryCode={countryCode}
      productId={productId}
      totalReviews={reviewResult.total ?? 0}
      averageRating={ratingSummary?.averageRating ?? 0}
      initialReviews={initialReviews}
    />
  )
}
