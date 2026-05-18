"use client"

import Image from "next/image"
import { useTranslations } from "next-intl"
import { Button } from "@components/common/ui/button"
import type { WritableReview } from "../../types"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
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
  const t = useTranslations("mypage.reviews")
  const expiresAt = new Date(review.expiresAt)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  expiresAt.setHours(0, 0, 0, 0)

  const diffDays = Math.ceil(
    (expiresAt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  )

  const formattedExpiresAt = formatDate(review.expiresAt, DATE_FORMATS.KO_DOT)

  const maxReward = Math.max(...rewardPolicies.map((p) => p.rewardAmount))

  return (
    <article className="w-full bg-[#FFFFFF]">
      <div className="flex flex-col gap-3 p-4">
        <section className="flex items-start gap-3">
          <figure className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md border border-[#F0F0F0]">
            <Image
              src={getThumbnailUrl(review.productImage)}
              alt={t("thumbnailAlt", { name: review.productName })}
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
                    {t("maxRewardPrefix")}{" "}
                    <span className="font-bold text-[#1A1A1A]">
                      {t("maxRewardSuffix", { amount: maxReward.toLocaleString() })}
                    </span>
                  </p>
                )}
                <p className="flex items-center">
                  <span>{t("writeDeadline", { date: formattedExpiresAt })}</span>
                  {diffDays >= 0 && (
                    <span className="ml-1 text-sm font-medium text-red-500">
                      ({diffDays === 0 ? t("writeDeadlineDay") : t("writeDeadlineDays", { days: diffDays })})
                    </span>
                  )}
                </p>
              </div>
              <Button
                variant="default"
                onClick={onWriteReview}
                className="h-[36px] px-4 text-[14px] font-medium"
              >
                {t("writeReview")}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </article>
  )
}
