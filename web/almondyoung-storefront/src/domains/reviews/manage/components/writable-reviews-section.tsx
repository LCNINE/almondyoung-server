import { ReviewBenefitBanner } from "./review-benefit-banner"
import { ReviewListHeader } from "./review-list-header"
import { ReviewCardBeforeWritten } from "./review-card-before-written"
import { ReviewCardAfterWritten } from "./review-card-after-written"
import type { WritableReview } from "domains/reviews/manage/types"

interface WritableReviewsSectionProps {
  reviews: WritableReview[]
  editingReviewId: string | null
  isReviewBeingEdited: (reviewId: string) => boolean
  onStartEditing: (reviewId: string) => void
  onSave: (
    reviewId: string,
    data: { rating: number; text: string }
  ) => Promise<void>
  onCancel: () => void
}

/**
 * 작성 가능한 리뷰 섹션 컴포넌트
 * 조합 패턴을 사용하여 Props Drilling 해결
 */
export const WritableReviewsSection = ({
  reviews,
  editingReviewId,
  isReviewBeingEdited,
  onStartEditing,
  onSave,
  onCancel,
}: WritableReviewsSectionProps) => {
  return (
    <section>
      <ReviewBenefitBanner />

      <ReviewListHeader title="리뷰" count={reviews.length} />

      <ul className="overflow-hidden rounded-lg border border-[#F0F0F0] bg-[#FFFFFF] shadow-sm">
        {reviews.map((item) => {
          const isBeingEdited = isReviewBeingEdited(item.id)

          return (
            <li
              key={item.id}
              className="border-gray-30 border-t first:border-t-0"
            >
              {isBeingEdited ? (
                <ReviewCardAfterWritten
                  product={item.product}
                  review={{ rating: 0, text: "" }}
                  onSave={(data) => onSave(item.id, data)}
                  onDelete={onCancel}
                />
              ) : (
                <ReviewCardBeforeWritten
                  product={item.product}
                  benefit={item.benefit}
                  onWriteReview={() => onStartEditing(item.id)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
