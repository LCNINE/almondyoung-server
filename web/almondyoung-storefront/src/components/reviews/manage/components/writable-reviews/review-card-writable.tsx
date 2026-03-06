"use client"

import Image from "next/image"
import { Button } from "@components/common/ui/button"
import type { WritableReview } from "../../types"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import type { RewardPolicy } from "@/lib/types/ui/ugc"

interface ReviewCardWritableProps {
  review: WritableReview
  onWriteReview: () => void
  rewardPolicies: RewardPolicy[]
}

export const ReviewCardWritable = ({
  review,
  onWriteReview,
  rewardPolicies,
}: ReviewCardWritableProps) => {
  const expiresAt = new Date(review.expiresAt)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  expiresAt.setHours(0, 0, 0, 0)

  const diffDays = Math.ceil(
    (expiresAt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  )

  const formattedExpiresAt = new Date(review.expiresAt).toLocaleDateString(
    "ko-KR"
  )

  const maxReward = Math.max(...rewardPolicies.map((p) => p.rewardAmount))

  return (
    <article className="w-full bg-[#FFFFFF]">
      <div className="flex flex-col gap-3 p-4">
        <section className="flex items-start gap-3">
          <figure className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md border border-[#F0F0F0]">
            <Image
              src={getThumbnailUrl(review.productImage)}
              alt={`${review.productName} 썸네일`}
              width={96}
              height={96}
              className="object-cover"
            />
          </figure>

          <div className="flex min-h-24 flex-1 flex-col justify-between">
            <h3 className="line-clamp-2 text-[15px] leading-[22px] font-bold text-[#1A1A1A]">
              {review.productName}
            </h3>
            <div className="flex items-end justify-between">
              <div className="text-[#666666]">
                {maxReward > 0 && (
                  <p className="text-sm">
                    포인트 최대{" "}
                    <span className="font-bold text-[#1A1A1A]">
                      {maxReward.toLocaleString()}원
                    </span>
                  </p>
                )}
                <p className="flex items-center">
                  <span>작성기한 {formattedExpiresAt}</span>
                  {diffDays >= 0 && (
                    <span className="ml-1 text-sm font-medium text-red-500">
                      (D-{diffDays === 0 ? "Day" : diffDays})
                    </span>
                  )}
                </p>
              </div>
              <Button
                variant="default"
                onClick={onWriteReview}
                className="h-[36px] px-4 text-[14px] font-medium"
              >
                리뷰쓰기
              </Button>
            </div>
          </div>
        </section>
      </div>
    </article>
  )
}
