"use client"

import { useState } from "react"
import type { WritableReview } from "../../types"
import { createReviewAction } from "../../actions/review-actions"
import { ReviewBenefitBanner } from "./review-benefit-banner"
import { ReviewCardWritable } from "./review-card-writable"
import { ReviewFormCard } from "./review-form-card"

interface WritableReviewsSectionProps {
  reviews: WritableReview[]
}

export const WritableReviewsSection = ({
  reviews,
}: WritableReviewsSectionProps) => {
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null)

  const handleSave = async (item: WritableReview, data: { rating: number; text: string }) => {
    await createReviewAction(item, data)
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
      <ReviewBenefitBanner />

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
