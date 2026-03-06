"use client"

import { useState } from "react"
import type { WritableReview, ReviewInfo } from "../../types"
import type { RewardPolicyResponseDto } from "@/lib/types/dto/ugc"
import { createReview } from "@/lib/api/ugc/reviews"
import { ReviewBenefitBanner } from "./review-benefit-banner"
import { ReviewCardWritable } from "./review-card-writable"
import { ReviewFormCard } from "./review-form-card"

interface WritableReviewsSectionProps {
  reviews: WritableReview[]
  rewardPolicies: RewardPolicyResponseDto[]
}

export const WritableReviewsSection = ({
  reviews,
  rewardPolicies,
}: WritableReviewsSectionProps) => {
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null)

  const handleSave = async (item: WritableReview, data: ReviewInfo) => {
    await createReview({
      eligibilityId: item.id,
      productId: item.productId,
      rating: data.rating,
      content: data.text,
      ...(data.mediaFileIds?.length && { mediaFileIds: data.mediaFileIds }),
    })
    setEditingReviewId(null)
  }

  if (reviews.length === 0) {
    return (
      <section>
        <p className="text-center text-gray-500">
          작성 가능한 리뷰가 없습니다.
        </p>
      </section>
    )
  }

  return (
    <section>
      <ReviewBenefitBanner policies={rewardPolicies} />

      <ul className="overflow-hidden rounded-lg border border-[#F0F0F0] bg-[#FFFFFF] shadow-sm">
        {reviews.map((item) => {
          const isBeingEdited = editingReviewId === item.id

          return (
            <li
              key={item.id}
              className="border-gray-30 border-t first:border-t-0"
            >
              {isBeingEdited ? (
                <ReviewFormCard
                  review={item}
                  rewardPolicies={rewardPolicies}
                  onSave={(data) => handleSave(item, data)}
                  onCancel={() => setEditingReviewId(null)}
                />
              ) : (
                <ReviewCardWritable
                  review={item}
                  onWriteReview={() => setEditingReviewId(item.id)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
