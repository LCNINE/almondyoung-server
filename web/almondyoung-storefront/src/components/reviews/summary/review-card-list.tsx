import { ReviewSummaryCard } from "@/components/reviews/summary/review-summary-card"
import type { Review } from "@/components/reviews/summary/review-summary-card"

export type ReviewCardListProps = {
  reviews: Review[]
}

/**
 * @description 리뷰 카드 목록
 */
export function ReviewCardList({ reviews }: ReviewCardListProps) {
  return (
    // 리뷰 '목록'이므로 <ul> 사용
    // space-y-4 대신 divide-y (구분선)로 변경
    <ul className="divide-y divide-gray-100">
      {reviews.map((review) => (
        // 각 리뷰 카드를 <li>로 감쌈
        <li key={review.id}>
          <ReviewSummaryCard review={review} />
        </li>
      ))}
    </ul>
  )
}
