import { describe, expect, it } from "vitest"

import type { ShippingGroup } from "../api/medusa/shipping-group-types"
import { resolveShippingGroupNotice } from "./shipping-group-notice"

const GROUPS: ShippingGroup[] = [
  {
    code: "default",
    name: "기본배송",
    policy: { type: "conditional_free", baseFee: 2500, freeThreshold: 50_000 },
  },
  { code: "needle", name: "결 카트리지 니들", policy: { type: "flat", baseFee: 3000 } },
  { code: "gift", name: "사은품", policy: { type: "free", baseFee: 0 } },
  {
    code: "bulky",
    name: "대형",
    policy: { type: "per_quantity", baseFee: 5000 },
  },
  {
    code: "meal",
    name: "간편식",
    policy: { type: "conditional_free", baseFee: 4000, freeThreshold: 30_000 },
  },
]

describe("resolveShippingGroupNotice", () => {
  // 기본 그룹은 무료배송 진행바가 이미 설명한다. 여기까지 안내를 달면 잡음이 되어 오히려 문의가 는다.
  it("기본 그룹(코드 없음·공백 포함)은 그리지 않는다", () => {
    expect(resolveShippingGroupNotice(null, GROUPS)).toBeNull()
    expect(resolveShippingGroupNotice(undefined, GROUPS)).toBeNull()
    expect(resolveShippingGroupNotice({}, GROUPS)).toBeNull()
    expect(
      resolveShippingGroupNotice({ shippingGroupCode: "  " }, GROUPS)
    ).toBeNull()
    expect(
      resolveShippingGroupNotice({ shippingGroupCode: "default" }, GROUPS)
    ).toBeNull()
  })

  it("flat 그룹은 그룹명과 금액을 준다", () => {
    expect(
      resolveShippingGroupNotice({ shippingGroupCode: "needle" }, GROUPS)
    ).toEqual({ key: "flat", group: "결 카트리지 니들", amount: 3000 })
  })

  it("per_quantity 그룹은 개당 금액을 준다", () => {
    expect(
      resolveShippingGroupNotice({ shippingGroupCode: "bulky" }, GROUPS)
    ).toEqual({ key: "perQuantity", group: "대형", amount: 5000 })
  })

  it("conditional_free 그룹은 무료 기준 금액까지 준다", () => {
    expect(
      resolveShippingGroupNotice({ shippingGroupCode: "meal" }, GROUPS)
    ).toEqual({
      key: "conditionalFree",
      group: "간편식",
      amount: 4000,
      threshold: 30_000,
    })
  })

  it("코드 앞뒤 공백은 무시하고 같은 그룹으로 판정한다", () => {
    expect(
      resolveShippingGroupNotice({ shippingGroupCode: " needle " }, GROUPS)
    ).toEqual({ key: "flat", group: "결 카트리지 니들", amount: 3000 })
  })

  it("무료(free) 정책 그룹은 그리지 않는다", () => {
    expect(
      resolveShippingGroupNotice({ shippingGroupCode: "gift" }, GROUPS)
    ).toBeNull()
  })

  // 정책을 모르면 조용한 쪽이 거짓말보다 낫다.
  it("그룹을 못 찾거나 목록이 비면 그리지 않는다", () => {
    expect(
      resolveShippingGroupNotice({ shippingGroupCode: "ghost" }, GROUPS)
    ).toBeNull()
    expect(
      resolveShippingGroupNotice({ shippingGroupCode: "needle" }, [])
    ).toBeNull()
    expect(
      resolveShippingGroupNotice({ shippingGroupCode: "needle" }, null)
    ).toBeNull()
  })

  it("그룹 설명이 있으면 넘겨주고, 공백뿐이면 뺀다", () => {
    const withDescription: ShippingGroup[] = [
      {
        code: "needle",
        name: "결 카트리지 니들",
        policy: { type: "flat", baseFee: 3000 },
        description: "다른 출고지에서 개별 배송됩니다.",
      },
      {
        code: "bulky",
        name: "대형",
        policy: { type: "per_quantity", baseFee: 5000 },
        description: "  ",
      },
    ]
    expect(
      resolveShippingGroupNotice({ shippingGroupCode: "needle" }, withDescription)
    ).toEqual({
      key: "flat",
      group: "결 카트리지 니들",
      amount: 3000,
      description: "다른 출고지에서 개별 배송됩니다.",
    })
    expect(
      resolveShippingGroupNotice({ shippingGroupCode: "bulky" }, withDescription)
    ).toEqual({ key: "perQuantity", group: "대형", amount: 5000 })
  })

  it("코드가 문자열이 아니면 기본 그룹으로 보고 그리지 않는다", () => {
    expect(
      resolveShippingGroupNotice({ shippingGroupCode: 3000 }, GROUPS)
    ).toBeNull()
  })
})
