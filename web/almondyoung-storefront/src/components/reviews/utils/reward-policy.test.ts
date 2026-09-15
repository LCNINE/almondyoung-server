import { describe, expect, it } from "vitest"
import type { RewardPolicy } from "@/lib/types/ui/ugc"
import { reviewPolicyNoticeKey, toRewardDisplay } from "./reward-policy"

const policy = (over: Partial<RewardPolicy>): RewardPolicy =>
  ({
    reviewType: "TEXT",
    rewardKind: "POINT_FIXED",
    rewardAmount: 500,
    ratePercent: null,
    maxAmount: null,
    minContentLength: 30,
    minMediaCount: 0,
    minRating: null,
    everyNthReview: null,
    expiresInDays: null,
    ...over,
  }) as RewardPolicy

describe("reviewPolicyNoticeKey", () => {
  it("활성 규칙이 하나도 없으면 적립을 말하지 않는 문구를 고른다", () => {
    expect(reviewPolicyNoticeKey([])).toBe("policyNoticeNoReward")
  })

  it("금전 지급이 없는 규칙(BADGE)만 있어도 적립을 말하지 않는다", () => {
    const badge = policy({ rewardKind: "BADGE", rewardAmount: null })
    expect(reviewPolicyNoticeKey([badge])).toBe("policyNoticeNoReward")
  })

  it("정액 지급이 있으면 적립 안내 문구를 고른다", () => {
    expect(reviewPolicyNoticeKey([policy({})])).toBe("policyNotice")
  })

  it("정률 지급이 있으면 적립 안내 문구를 고른다", () => {
    const rate = policy({ rewardKind: "POINT_RATE", rewardAmount: null, ratePercent: 3 })
    expect(reviewPolicyNoticeKey([rate])).toBe("policyNotice")
  })

  it("안내 문구 선택은 배너·카드가 쓰는 판정과 같은 축이다", () => {
    const cases: RewardPolicy[][] = [
      [],
      [policy({ rewardKind: "BADGE", rewardAmount: null })],
      [policy({})],
      [policy({ rewardKind: "POINT_RATE", rewardAmount: null, ratePercent: 3 })],
    ]
    for (const policies of cases) {
      const sameAxis =
        toRewardDisplay(policies).kind === "none"
          ? "policyNoticeNoReward"
          : "policyNotice"
      expect(reviewPolicyNoticeKey(policies)).toBe(sameAxis)
    }
  })
})
