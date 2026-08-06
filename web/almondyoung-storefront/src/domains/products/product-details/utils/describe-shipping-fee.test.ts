import { describe, expect, it } from "vitest"

import type { ShippingGroup } from "../../../../lib/api/medusa/shipping-group-types"
import { describeShippingFee } from "./describe-shipping-fee"

const GROUPS: ShippingGroup[] = [
  {
    code: "default",
    name: "기본배송",
    policy: { type: "conditional_free", baseFee: 2500, freeThreshold: 50_000 },
  },
  { code: "meal", name: "간편식 배송", policy: { type: "flat", baseFee: 3000 } },
  { code: "gift", name: "사은품", policy: { type: "free", baseFee: 0 } },
  {
    code: "bulky",
    name: "대형",
    policy: { type: "per_quantity", baseFee: 5000 },
  },
]

describe("describeShippingFee", () => {
  it("그룹 코드가 없으면 기본 그룹 정책을 쓴다", () => {
    expect(describeShippingFee(null, GROUPS)).toEqual({
      kind: "conditionalFree",
      amount: 2500,
      threshold: 50_000,
    })
    expect(describeShippingFee({ shippingGroupCode: "  " }, GROUPS)).toEqual({
      kind: "conditionalFree",
      amount: 2500,
      threshold: 50_000,
    })
  })

  it("상품의 그룹 정책을 쓴다", () => {
    expect(describeShippingFee({ shippingGroupCode: "meal" }, GROUPS)).toEqual({
      kind: "flat",
      amount: 3000,
    })
    expect(describeShippingFee({ shippingGroupCode: "gift" }, GROUPS)).toEqual({
      kind: "free",
    })
    expect(describeShippingFee({ shippingGroupCode: "bulky" }, GROUPS)).toEqual({
      kind: "perQuantity",
      amount: 5000,
    })
  })

  // 그룹 조회가 실패했는데 옛 고정 문구로 되돌아가면 다시 거짓말이 된다.
  it("모르는 그룹이거나 목록이 비면 unknown", () => {
    expect(describeShippingFee({ shippingGroupCode: "ghost" }, GROUPS)).toEqual({
      kind: "unknown",
    })
    expect(describeShippingFee(null, [])).toEqual({ kind: "unknown" })
  })
})
