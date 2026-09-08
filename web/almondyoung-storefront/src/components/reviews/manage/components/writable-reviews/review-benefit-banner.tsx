"use client"

import { useTranslations } from "next-intl"
import type { RewardPolicy } from "@/lib/types/ui/ugc"
import { toRewardDisplay } from "../../../utils/reward-policy"

interface ReviewBenefitBannerProps {
  policies: RewardPolicy[]
  reviewCount: number
}

export const ReviewBenefitBanner = ({
  policies,
  reviewCount,
}: ReviewBenefitBannerProps) => {
  const t = useTranslations("mypage.reviews")
  const reward = toRewardDisplay(policies)

  // 지급 안내가 없으면(활성 규칙 없음·비금전만) 배너를 띄우지 않는다 — 못 지킬 약속을 걸지 않는다.
  if (reviewCount === 0 || reward.kind === "none") return null

  const rewardLabel =
    reward.kind === "fixed"
      ? t("benefitBannerAmount", { amount: (reward.amount * reviewCount).toLocaleString() })
      : reward.maxAmount !== null
        ? t("rewardRateCapped", { percent: reward.percent, amount: reward.maxAmount.toLocaleString() })
        : t("rewardRate", { percent: reward.percent })

  return (
    <div className="mb-4 rounded-xl border border-orange-100 bg-linear-to-r from-orange-50 to-amber-50 p-4">
      <p className="text-[15px] font-semibold text-gray-800">
        {t.rich("benefitBanner", {
          amount: () => <span className="text-[#FF9500]">{rewardLabel}</span>,
        })}
      </p>
    </div>
  )
}
