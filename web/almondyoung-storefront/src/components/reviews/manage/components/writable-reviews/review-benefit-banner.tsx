import type { RewardPolicy } from "@/lib/types/ui/ugc"

interface ReviewBenefitBannerProps {
  policies: RewardPolicy[]
}

export const ReviewBenefitBanner = ({ policies }: ReviewBenefitBannerProps) => {
  if (policies.length === 0) return null

  const maxAmount = Math.max(...policies.map((p) => p.rewardAmount))

  return (
    <div className="mb-4 rounded-xl border border-orange-100 bg-gradient-to-r from-orange-50 to-amber-50 p-4">
      <p className="text-[15px] font-semibold text-gray-800">
        리뷰 작성하고{" "}
        <span className="text-[#FF9500]">
          최대 {maxAmount.toLocaleString()}원
        </span>{" "}
        적립 받으세요!
      </p>
    </div>
  )
}
