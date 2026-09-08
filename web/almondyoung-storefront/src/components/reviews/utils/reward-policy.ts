import type { RewardPolicy } from "@/lib/types/ui/ugc"

/**
 * 고객에게 보여줄 보상 안내의 모양.
 *
 * 지급 방식이 정액이면 금액 하나로 말할 수 있지만, 정률이면 주문마다 달라져
 * 대표값 하나로 뭉개면 화면 문구가 실제 지급액과 어긋난다. 그래서 종류를 나눠 돌려준다.
 * 활성 규칙이 없으면(=관리자가 아무것도 켜지 않은 기본 상태) "none" 이고, 화면은 아무 문구도 띄우지 않는다.
 */
export type RewardDisplay =
  | { kind: "none" }
  | { kind: "fixed"; amount: number }
  | { kind: "rate"; percent: number; maxAmount: number | null }

export function toRewardDisplay(
  policies: RewardPolicy[],
  reviewType?: "TEXT" | "PHOTO"
): RewardDisplay {
  const scoped = reviewType
    ? policies.filter((policy) => policy.reviewType === reviewType)
    : policies

  const fixedAmounts = scoped
    .filter((policy) => policy.rewardKind === "POINT_FIXED")
    .map((policy) => policy.rewardAmount)
    .filter((amount) => amount > 0)

  if (fixedAmounts.length > 0) {
    return { kind: "fixed", amount: Math.max(...fixedAmounts) }
  }

  const rate = scoped.find(
    (policy) => policy.rewardKind === "POINT_RATE" && policy.ratePercent !== null
  )

  if (rate && rate.ratePercent !== null) {
    return { kind: "rate", percent: rate.ratePercent, maxAmount: rate.maxAmount }
  }

  return { kind: "none" }
}
