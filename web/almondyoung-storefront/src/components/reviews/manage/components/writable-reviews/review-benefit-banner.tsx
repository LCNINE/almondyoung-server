"use client"

import { useTranslations } from "next-intl"
import type { RewardPolicy } from "@/lib/types/ui/ugc"

interface ReviewBenefitBannerProps {
  policies: RewardPolicy[]
  reviewCount: number
}

export const ReviewBenefitBanner = ({
  policies,
  reviewCount,
}: ReviewBenefitBannerProps) => {
  const t = useTranslations("mypage.reviews")
  if (policies.length === 0 || reviewCount === 0) return null

  const maxPerReview = Math.max(...policies.map((p) => p.rewardAmount))
  const totalMaxAmount = maxPerReview * reviewCount

  return (
    <div className="mb-4 rounded-xl border border-orange-100 bg-linear-to-r from-orange-50 to-amber-50 p-4">
      <p className="text-[15px] font-semibold text-gray-800">
        {t.rich("benefitBanner", {
          amount: () => (
            <span className="text-[#FF9500]">
              {t("benefitBannerAmount", { amount: totalMaxAmount.toLocaleString() })}
            </span>
          ),
        })}
      </p>
    </div>
  )
}
