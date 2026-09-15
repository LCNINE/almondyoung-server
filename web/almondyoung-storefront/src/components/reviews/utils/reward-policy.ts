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

  // 서버는 정률·BADGE 의 rewardAmount 를 null 로 내려보낸다 — 금액을 하나로 말할 수 없어서다.
  // 0 으로 뭉개진 값을 걸러 내던 자리가 그대로 null 을 거르는 자리가 된다.
  const fixedAmounts = scoped
    .filter((policy) => policy.rewardKind === "POINT_FIXED")
    .map((policy) => policy.rewardAmount)
    .filter((amount): amount is number => amount !== null && amount > 0)

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

/** 리뷰 폼 하단 안내 문구의 i18n 키. */
export type ReviewPolicyNoticeKey = "policyNotice" | "policyNoticeNoReward"

/**
 * 안내 문구를 고른다.
 *
 * 기본 문구는 「사진 기준으로 포인트가 적립되고, 무관한 첨부는 적립이 회수된다」고 말한다 —
 * 지급이 하나도 없는 상태(활성 규칙 없음·비금전만)에서 그대로 띄우면 못 지킬 약속이 된다.
 * 그때는 첨부물 안내만 남긴 문구로 바꾼다. 배너·카드가 쓰는 기준(`toRewardDisplay`)과 같은 축이라
 * 한 화면 안에서 「적립 안내는 없는데 적립을 말하는 주의문구만 있는」 상태가 생기지 않는다.
 */
export function reviewPolicyNoticeKey(
  policies: RewardPolicy[]
): ReviewPolicyNoticeKey {
  return toRewardDisplay(policies).kind === "none"
    ? "policyNoticeNoReward"
    : "policyNotice"
}
