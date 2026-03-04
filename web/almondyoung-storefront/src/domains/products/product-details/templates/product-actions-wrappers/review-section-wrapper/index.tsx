import { ReviewDetailCardList } from "@/components/reviews/details/review-detail-card-list"
import { getRatingSummary, getReviewsByProductId } from "@/lib/api/ugc/reviews"
import type { ReviewSortOption } from "@/lib/types/common/filter"
import type { RatingSummaryResponseDto } from "@/lib/types/dto/ugc"

const ITEMS_PER_PAGE = 10

interface Props {
  productId: string
  countryCode: string
}

export async function ReviewSectionWrapper({ productId, countryCode }: Props) {
  const [ratingSummary, reviewResult] = await Promise.all([
    getRatingSummary(productId).catch(
      (): RatingSummaryResponseDto | null => null
    ),
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
