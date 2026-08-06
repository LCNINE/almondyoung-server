import { describe, expect, it } from "vitest"

import {
  collectRequiredShippingProfileIds,
  selectShippingOptionsForCart,
  shippingMethodsMatchOptions,
} from "./shipping-method-policy"

const OPTIONS = [
  { id: "so_default", shipping_profile_id: "sp_default", type: { code: "standard" } },
  { id: "so_meal", shipping_profile_id: "sp_meal", type: { code: "standard" } },
  { id: "so_return", shipping_profile_id: "sp_default", type: { code: "return" } },
]

const physical = (profileId?: string) => ({
  requires_shipping: true,
  ...(profileId ? { product: { shipping_profile: { id: profileId } } } : {}),
})

const digital = { requires_shipping: false }

describe("collectRequiredShippingProfileIds", () => {
  it("배송이 필요한 라인의 profile 만 모은다", () => {
    const ids = collectRequiredShippingProfileIds([
      physical("sp_default"),
      physical("sp_meal"),
      physical("sp_meal"),
      { ...digital, product: { shipping_profile: { id: "sp_ignored" } } },
    ])
    expect(Array.from(ids).sort()).toEqual(["sp_default", "sp_meal"])
  })

  it("profile 정보가 없으면 빈 집합", () => {
    expect(collectRequiredShippingProfileIds([physical()]).size).toBe(0)
    expect(collectRequiredShippingProfileIds(null).size).toBe(0)
  })
})

describe("selectShippingOptionsForCart", () => {
  it("배송이 필요 없으면 아무것도 고르지 않는다", () => {
    expect(selectShippingOptionsForCart(OPTIONS, [digital])).toEqual([])
  })

  it("카트에 담긴 그룹만, 그룹당 하나씩 고른다", () => {
    expect(selectShippingOptionsForCart(OPTIONS, [physical("sp_meal")]).map((o) => o.id)).toEqual([
      "so_meal",
    ])
  })

  it("그룹이 2개면 2개를 고른다", () => {
    expect(
      selectShippingOptionsForCart(OPTIONS, [physical("sp_default"), physical("sp_meal")]).map(
        (o) => o.id
      )
    ).toEqual(["so_default", "so_meal"])
  })

  it("standard 가 아닌 옵션은 제외한다", () => {
    expect(
      selectShippingOptionsForCart(OPTIONS, [physical("sp_default")]).map((o) => o.id)
    ).toEqual(["so_default"])
  })

  // 잘못 걸러 배송수단이 빠지면 결제가 막히므로, 판정 불가일 땐 전부 유지한다.
  it("라인에 profile 정보가 없으면 그룹당 하나씩 전부 유지한다", () => {
    expect(selectShippingOptionsForCart(OPTIONS, [physical()]).map((o) => o.id)).toEqual([
      "so_default",
      "so_meal",
    ])
  })
})

describe("shippingMethodsMatchOptions", () => {
  it("집합이 정확히 같을 때만 참", () => {
    expect(shippingMethodsMatchOptions(["so_a", "so_b"], [{ id: "so_b" }, { id: "so_a" }])).toBe(true)
    expect(shippingMethodsMatchOptions(["so_a"], [{ id: "so_a" }, { id: "so_b" }])).toBe(false)
    expect(shippingMethodsMatchOptions(["so_a", "so_b"], [{ id: "so_a" }])).toBe(false)
    expect(shippingMethodsMatchOptions(null, [{ id: "so_a" }])).toBe(false)
    expect(shippingMethodsMatchOptions([], [])).toBe(true)
  })

  // 어드민이 그룹 금액을 고쳐도 이미 붙은 배송수단은 그대로 남는다. complete-cart 는
  // 저장된 금액을 그대로 청구하므로, 금액이 다르면 다시 붙여야 한다.
  it("구성이 같아도 금액이 다르면 거짓", () => {
    const current = [{ shipping_option_id: "so_a", amount: 3000 }]
    expect(shippingMethodsMatchOptions(current, [{ id: "so_a", amount: 3000 }])).toBe(true)
    expect(shippingMethodsMatchOptions(current, [{ id: "so_a", amount: 4000 }])).toBe(false)
  })

  it("여러 그룹 중 하나만 금액이 달라도 거짓", () => {
    const current = [
      { shipping_option_id: "so_a", amount: 2500 },
      { shipping_option_id: "so_b", amount: 3000 },
    ]
    expect(
      shippingMethodsMatchOptions(current, [
        { id: "so_a", amount: 2500 },
        { id: "so_b", amount: 3000 },
      ])
    ).toBe(true)
    expect(
      shippingMethodsMatchOptions(current, [
        { id: "so_a", amount: 2500 },
        { id: "so_b", amount: 9000 },
      ])
    ).toBe(false)
  })

  it("문자열 금액도 같은 값이면 일치로 본다", () => {
    expect(
      shippingMethodsMatchOptions([{ shipping_option_id: "so_a", amount: "2500" }], [
        { id: "so_a", amount: 2500 },
      ])
    ).toBe(true)
  })

  // 금액을 못 읽는 상황에서 매번 다시 붙이면 카트가 불필요하게 요동친다.
  it("어느 한쪽 금액을 모르면 금액 비교는 건너뛴다", () => {
    expect(
      shippingMethodsMatchOptions([{ shipping_option_id: "so_a" }], [{ id: "so_a", amount: 4000 }])
    ).toBe(true)
    expect(
      shippingMethodsMatchOptions([{ shipping_option_id: "so_a", amount: 3000 }], [{ id: "so_a" }])
    ).toBe(true)
  })
})
