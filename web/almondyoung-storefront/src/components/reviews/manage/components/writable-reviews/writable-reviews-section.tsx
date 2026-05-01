"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import type { WritableReview, ReviewInfo } from "../../types"
import type { RewardPolicy } from "@/lib/types/ui/ugc"
import { createReview } from "@/lib/api/ugc/reviews"
import { ReviewCardWritable } from "./review-card-writable"
import { ReviewFormCard } from "./review-form-card"
import { ReviewListHeader } from "../written-reviews/review-list-header"
import { ReviewPagination } from "../review-pagination"

interface WritableReviewsSectionProps {
  reviews: WritableReview[]
  totalCount: number
  currentPage: number
  totalPages: number
  rewardPolicies: RewardPolicy[]
}

export const WritableReviewsSection = ({
  reviews,
  totalCount,
  currentPage,
  totalPages,
  rewardPolicies,
}: WritableReviewsSectionProps) => {
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSave = (item: WritableReview, data: ReviewInfo) => {
    startTransition(async () => {
      try {
        await createReview({
          eligibilityId: item.id,
          productId: item.productId,
          rating: data.rating,
          content: data.text,
          ...(data.mediaFileIds?.length && { mediaFileIds: data.mediaFileIds }),
        })
        setEditingReviewId(null)
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error("리뷰 등록에 실패했습니다. 다시 시도해주세요.")
      }
    })
  }

  return (
    <section>
      <ReviewListHeader
        title="리뷰"
        count={totalCount}
        tooltipContent={
          <p className="text-xs text-[#333333]">
            리뷰 작성은{" "}
            <span className="font-medium text-green-600">구매확정 후 15일</span>
            까지 가능해요
          </p>
        }
      />

      {reviews.length === 0 ? (
        <p className="py-10 text-center text-gray-500">
          작성 가능한 리뷰가 없습니다.
        </p>
      ) : (
        <>
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
                      isSaving={isPending}
                    />
                  ) : (
                    <ReviewCardWritable
                      review={item}
                      onWriteReview={() => setEditingReviewId(item.id)}
                      rewardPolicies={rewardPolicies}
                    />
                  )}
                </li>
              )
            })}
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
