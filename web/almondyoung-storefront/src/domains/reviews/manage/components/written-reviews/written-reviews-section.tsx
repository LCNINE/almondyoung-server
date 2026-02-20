import { ReviewListHeader } from "./review-list-header"
import { ReviewFilters } from "./review-filters"
import { ReviewCardWritten } from "./review-card-written"
import type { WrittenReview } from "../../types"

interface WrittenReviewsSectionProps {
  reviews: WrittenReview[]
}

export const WrittenReviewsSection = ({
  reviews,
}: WrittenReviewsSectionProps) => {
  return (
    <section>
      <ReviewListHeader title="리뷰" count={reviews.length}>
        <ReviewFilters />
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
