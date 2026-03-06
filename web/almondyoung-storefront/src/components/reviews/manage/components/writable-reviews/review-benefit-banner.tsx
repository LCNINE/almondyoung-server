import type { RewardPolicy } from "@/lib/types/ui/ugc"

interface ReviewBenefitBannerProps {
  policies: RewardPolicy[]
  reviewCount: number
}

export const ReviewBenefitBanner = ({
  policies,
  reviewCount,
}: ReviewBenefitBannerProps) => {
  if (policies.length === 0 || reviewCount === 0) return null

  const maxPerReview = Math.max(...policies.map((p) => p.rewardAmount))
  const totalMaxAmount = maxPerReview * reviewCount

  return (
    <div className="mb-4 rounded-xl border border-orange-100 bg-linear-to-r from-orange-50 to-amber-50 p-4">
      <p className="text-[15px] font-semibold text-gray-800">
        리뷰 작성하고{" "}
        <span className="text-[#FF9500]">
          최대 {totalMaxAmount.toLocaleString()}원
        </span>{" "}
        적립 받으세요!
      </p>
    </div>
  )
}
