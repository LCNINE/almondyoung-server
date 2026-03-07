import { ReviewListHeader } from "./review-list-header"
import { ReviewFilters } from "./review-filters"
import { ReviewCardWritten } from "./review-card-written"
import { ReviewPagination } from "../review-pagination"
import type { WrittenReview } from "../../types"
import type { ReviewPeriod, ReviewType } from "../../utils/constants"

interface WrittenReviewsSectionProps {
  reviews: WrittenReview[]
  totalCount: number
  currentPage: number
  totalPages: number
  period: ReviewPeriod
  type: ReviewType
}

export const WrittenReviewsSection = ({
  reviews,
  totalCount,
  currentPage,
  totalPages,
  period,
  type,
}: WrittenReviewsSectionProps) => {
  return (
    <section>
      <ReviewListHeader title="리뷰" count={totalCount}>
        <ReviewFilters period={period} type={type} />
      </ReviewListHeader>

      {reviews.length === 0 ? (
        <p className="py-10 text-center text-gray-500">
          작성한 리뷰가 없습니다.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {reviews.map((review) => (
              <li key={review.id}>
                <ReviewCardWritten review={review} />
              </li>
            ))}
          </ul>

          <div className="mt-6">
            <ReviewPagination
              currentPage={currentPage}
              totalPages={totalPages}
            />
          </div>
        </>
      )}
    </section>
  )
}
