import { WrittenReviewsSection } from "../../components/written-reviews/written-reviews-section"
import type { WrittenReview } from "../../types"

export async function WrittenReviewsWrapper() {
  // TODO: UGC 서비스에서 사용자별 리뷰 조회
  const writtenReviews: WrittenReview[] = []

  return <WrittenReviewsSection reviews={writtenReviews} />
}
