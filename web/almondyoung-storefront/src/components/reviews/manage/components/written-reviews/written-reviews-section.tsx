import { ReviewListHeader } from "./review-list-header"
import { ReviewFilters } from "./review-filters"
import { ReviewCardWritten } from "./review-card-written"
import type { WrittenReview } from "../../types"
import type { ReviewPeriod, ReviewType } from "../../utils/constants"

interface WrittenReviewsSectionProps {
  reviews: WrittenReview[]
  totalCount: number
  period: ReviewPeriod
  type: ReviewType
}

export const WrittenReviewsSection = ({
  reviews,
  totalCount,
  period,
  type,
}: WrittenReviewsSectionProps) => {
  return (
    <section>
      <ReviewListHeader title="리뷰" count={totalCount}>
        <ReviewFilters period={period} type={type} />
      </ReviewListHeader>

      <ul className="flex flex-col gap-4">
        {reviews.map((review) => (
          <li key={review.id}>
            <ReviewCardWritten review={review} />
          </li>
        ))}
      </ul>
    </section>
  )
}
