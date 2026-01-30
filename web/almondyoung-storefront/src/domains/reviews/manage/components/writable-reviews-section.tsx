import { ReviewBenefitBanner } from "./review-benefit-banner"
import { ReviewListHeader } from "./review-list-header"
import { ReviewCardBeforeWritten } from "./review-card-before-written"
import { ReviewCardAfterWritten } from "./review-card-after-written"
import type { WritableReview, ProductInfo, BenefitInfo } from "domains/reviews/manage/types"

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

  isReviewBeingEdited,
  onStartEditing,
  onSave,
  onCancel,
}: WritableReviewsSectionProps) => {
  // WritableReview를 ProductInfo와 BenefitInfo로 변환
  const convertToProductInfo = (review: WritableReview): ProductInfo => ({
    imageUrl: review.productImage,
    storeName: "올마이영", // TODO: 실제 스토어 이름이 필요한 경우 API에서 가져오기
    title: review.productName,
    options: review.variantTitle || "기본 옵션",
    purchaseDate: review.orderDate,
  })

  const convertToBenefitInfo = (): BenefitInfo => {
    // TODO: 실제 포인트 및 작성 기한 정보를 가져오기
    const deadline = new Date()
    deadline.setDate(deadline.getDate() + 7)

    return {
      points: 1000,
      deadline: `${deadline.getFullYear()}.${String(deadline.getMonth() + 1).padStart(2, '0')}.${String(deadline.getDate()).padStart(2, '0')}.`,
      dDay: 7,
    }
  }

  return (
    <section>
      <ReviewBenefitBanner />

      <ReviewListHeader title="리뷰" count={reviews.length} />

      <ul className="overflow-hidden rounded-lg border border-[#F0F0F0] bg-[#FFFFFF] shadow-sm">
        {reviews.map((item) => {
          const isBeingEdited = isReviewBeingEdited(item.id)
          const productInfo = convertToProductInfo(item)
          const benefitInfo = convertToBenefitInfo()

          return (
            <li
              key={item.id}
              className="border-gray-30 border-t first:border-t-0"
            >
              {isBeingEdited ? (
                <ReviewCardAfterWritten
                  product={productInfo}
                  review={{ rating: 0, text: "" }}
                  onSave={(data) => onSave(item.id, data)}
                  onDelete={onCancel}
                />
              ) : (
                <ReviewCardBeforeWritten
                  product={productInfo}
                  benefit={benefitInfo}
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
