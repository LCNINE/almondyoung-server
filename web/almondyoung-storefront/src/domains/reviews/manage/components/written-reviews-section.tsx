import { ReviewListHeader } from "./review-list-header"
import { ReviewFilters } from "./review-filters"
import { ReviewCardAfterWritten } from "./review-card-after-written"
import type { WrittenReview } from "../types"

interface WrittenReviewsSectionProps {
  reviews: WrittenReview[]
  onUpdate: (
    reviewId: string,
    data: { rating: number; text: string }
  ) => Promise<void>
  onDelete: (reviewId: string) => void
}

/**
 * 작성된 리뷰 섹션 컴포넌트
 * 조합 패턴을 사용하여 Props Drilling 해결
 */
export const WrittenReviewsSection = ({
  reviews,
  onUpdate,
  onDelete,
}: WrittenReviewsSectionProps) => {
  return (
    // [웹퍼블리셔 규칙 #1] 시맨틱 마크업: <section> 사용
    <section>
      {/* [웹퍼블리셔 규칙 #3] 단일 책임: 
        자식으로 <ReviewFilters />를 받아 조합(Composition)합니다.
      */}
      <ReviewListHeader title="리뷰" count={reviews.length}>
        <ReviewFilters />
      </ReviewListHeader>

      {/*
        [웹퍼블리셔 규칙 #1] 시맨틱 마크업: <div>를 <ul>로 변경
        [웹퍼블리셔 규칙 #2, #4] 컨테이너 책임 및 견고성:
        <ul>이 flex 레이아웃과 자식(li)들의 간격(gap-4)을 책임집니다.
      */}
      <ul className="flex flex-col gap-4">
        {reviews.map((review) => (
          // [웹퍼블리셔 규칙 #1] 시맨틱 마크업: <li> 추가
          <li key={review.id}>
            <ReviewCardAfterWritten
              product={review.productInfo}
              review={review.reviewData}
              onSave={(data) => onUpdate(review.id, data)}
              onDelete={() => onDelete(review.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
