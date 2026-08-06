import { describe, expect, it } from "vitest"

import type { ShippingGroup } from "../../../lib/api/medusa/shipping-group-types"
import {
  buildFreeShippingProgress,
  resolveShippingGroupCode,
} from "./build-free-shipping-progress"

const DEFAULT_GROUP: ShippingGroup = {
  code: "default",
  name: "기본배송",
  policy: { type: "conditional_free", baseFee: 2500, freeThreshold: 50_000 },
}

const MEAL_GROUP: ShippingGroup = {
  code: "meal",
  name: "간편식 배송",
  policy: { type: "conditional_free", baseFee: 3000, freeThreshold: 30_000 },
}

const FLAT_GROUP: ShippingGroup = {
  code: "bulky",
  name: "대형 배송",
  policy: { type: "flat", baseFee: 10_000 },
}

function line(
  unitPrice: number,
  quantity: number,
  groupCode?: string,
  extra: Partial<{ requires_shipping: boolean; product_type: string }> = {}
) {
  return {
    unit_price: unitPrice,
    quantity,
    product: groupCode ? { metadata: { shippingGroupCode: groupCode } } : null,
    ...extra,
  }
}

describe("resolveShippingGroupCode", () => {
  it("metadata 가 없으면 기본 그룹", () => {
    expect(resolveShippingGroupCode(line(1000, 1))).toBe("default")
    expect(
      resolveShippingGroupCode({ product: { metadata: { shippingGroupCode: "  " } } })
    ).toBe("default")
  })

  it("metadata 의 코드를 쓴다", () => {
    expect(resolveShippingGroupCode(line(1000, 1, "meal"))).toBe("meal")
  })
})

describe("buildFreeShippingProgress", () => {
  it("그룹 소계로 판정한다 — 다른 그룹 금액이 섞이지 않는다", () => {
    const entries = buildFreeShippingProgress(
      [line(60_000, 1), line(3_000, 1, "meal")],
      [DEFAULT_GROUP, MEAL_GROUP]
    )

    expect(entries).toEqual([
      expect.objectContaining({
        groupCode: "default",
        subtotal: 60_000,
        reached: true,
        remaining: 0,
        percent: 100,
      }),
      expect.objectContaining({
        groupCode: "meal",
        subtotal: 3_000,
        reached: false,
        remaining: 27_000,
        percent: 10,
      }),
    ])
  })

  it("담긴 상품이 없는 그룹은 진행바를 만들지 않는다", () => {
    const entries = buildFreeShippingProgress([line(10_000, 1)], [DEFAULT_GROUP, MEAL_GROUP])
    expect(entries.map((entry) => entry.groupCode)).toEqual(["default"])
  })

  it("조건부 무료가 아닌 그룹은 제외한다", () => {
    const entries = buildFreeShippingProgress([line(10_000, 1, "bulky")], [FLAT_GROUP])
    expect(entries).toEqual([])
  })

  it("수량을 곱해 합산한다", () => {
    const [entry] = buildFreeShippingProgress([line(10_000, 3)], [DEFAULT_GROUP])
    expect(entry.subtotal).toBe(30_000)
  })

  it("배송이 필요 없는 라인은 제외한다", () => {
    const entries = buildFreeShippingProgress(
      [line(90_000, 1, undefined, { requires_shipping: false })],
      [DEFAULT_GROUP]
    )
    expect(entries).toEqual([])
  })

  it("그룹 목록이 비어 있으면 아무것도 그리지 않는다", () => {
    expect(buildFreeShippingProgress([line(10_000, 1)], [])).toEqual([])
    expect(buildFreeShippingProgress(null, null)).toEqual([])
  })
})
