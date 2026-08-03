import { describe, expect, it } from "vitest"
import {
  buildAvailabilityMap,
  describeStockShortage,
  getAvailableQuantity,
  isInsufficientInventoryError,
  isVariantQuantityUnavailable,
  isVariantSoldOut,
} from "./cart-availability"

const tracked = { manage_inventory: true, allow_backorder: false }

describe("getAvailableQuantity", () => {
  it("재고를 추적하는 variant 는 남은 수량을 준다", () => {
    expect(getAvailableQuantity({ ...tracked, inventory_quantity: 3 })).toBe(3)
  })

  it("음수 재고는 0 으로 본다", () => {
    expect(getAvailableQuantity({ ...tracked, inventory_quantity: -2 })).toBe(0)
  })

  it("재고 미추적/백오더 허용은 상한 없음(null)", () => {
    expect(
      getAvailableQuantity({ manage_inventory: false, inventory_quantity: 0 })
    ).toBeNull()
    expect(
      getAvailableQuantity({ ...tracked, allow_backorder: true, inventory_quantity: 0 })
    ).toBeNull()
  })

  it("variant 를 모르면 상한 없음 — 조회 실패로 구매를 막지 않는다", () => {
    expect(getAvailableQuantity(undefined)).toBeNull()
    expect(getAvailableQuantity(null)).toBeNull()
  })
})

// 재고부족을 전부 "품절" 로 안내하던 것이 문제였다. 재고가 남아있는데 요청 수량만 넘긴 경우와,
// 장바구니에 담긴 수량까지 합쳐 넘긴 경우는 고객이 취할 행동이 달라 구분해서 안내해야 한다.
describe("describeStockShortage", () => {
  it("요청 수량이 남은 재고보다 많으면 수량을 알려줄 수 있다", () => {
    expect(describeStockShortage({ available: 2, quantity: 5 })).toBe("exceeds-stock")
  })

  it("재고 안에서 요청했는데도 실패하면 장바구니 합산 초과로 본다", () => {
    expect(describeStockShortage({ available: 5, quantity: 2 })).toBe("cart-sum")
    expect(describeStockShortage({ available: 5, quantity: 5 })).toBe("cart-sum")
  })

  it("재고 0 은 품절로 구분한다 — 수량 안내로 가면 '0개 이하로 담아주세요' 가 된다", () => {
    expect(describeStockShortage({ available: 0, quantity: 1 })).toBe("sold-out")
    expect(describeStockShortage({ available: 0, quantity: 9 })).toBe("sold-out")
  })

  it("남은 재고를 모르는 화면은 수량 없는 일반 안내로 떨어진다", () => {
    expect(describeStockShortage({})).toBe("unknown")
    expect(describeStockShortage({ available: null, quantity: 3 })).toBe("unknown")
  })

  it("수량을 안 넘기면 1개 담기로 본다", () => {
    expect(describeStockShortage({ available: 1 })).toBe("cart-sum")
    expect(describeStockShortage({ available: 1, quantity: 2 })).toBe("exceeds-stock")
  })
})

describe("isInsufficientInventoryError", () => {
  it("Medusa 재고부족 원문을 알아본다 (이 판정이 깨지면 영문 원문이 그대로 토스트에 뜬다)", () => {
    expect(
      isInsufficientInventoryError(
        new Error("Some variant does not have the required inventory")
      )
    ).toBe(true)
    expect(isInsufficientInventoryError("Variant does not have the required inventory")).toBe(
      true
    )
  })

  it("다른 에러는 재고부족으로 오인하지 않는다", () => {
    expect(isInsufficientInventoryError(new Error("Cart not found"))).toBe(false)
    expect(isInsufficientInventoryError(undefined)).toBe(false)
  })
})

// 카트 라인아이템에 붙어오는 variant 에는 inventory_quantity 가 없다. 그걸 폴백으로 쓰면
// 전 라인이 재고 0 으로 읽혀 수량 증가가 통째로 막히고 "재고가 0개 남았어요" 가 뜬다.
describe("buildAvailabilityMap", () => {
  const fetched = new Map([
    ["variant_a", { ...tracked, inventory_quantity: 4 }],
    ["variant_b", { manage_inventory: false, inventory_quantity: 0 }],
  ])

  it("재고가 계산된 variant 만 상한을 갖는다", () => {
    const map = buildAvailabilityMap(
      [{ variant_id: "variant_a" }, { variant_id: "variant_b" }],
      fetched
    )
    expect(map).toEqual({ variant_a: 4 })
  })

  it("상품 조회에 없던 variant 는 상한을 두지 않는다 (조회 실패로 구매를 막지 않는다)", () => {
    const map = buildAvailabilityMap([{ variant_id: "variant_missing" }], fetched)
    expect(map).toEqual({})
    expect(map.variant_missing).toBeUndefined()
  })

  it("조회가 통째로 실패해도(빈 맵) 아무 라인도 막지 않는다", () => {
    const map = buildAvailabilityMap(
      [{ variant_id: "variant_a" }, { variant_id: "variant_b" }],
      new Map()
    )
    expect(map).toEqual({})
  })

  it("variant_id 가 없는 라인은 건너뛴다", () => {
    expect(buildAvailabilityMap([{ variant_id: null }, {}], fetched)).toEqual({})
  })
})

// 결제 전 게이트(체크아웃)가 쓰는 판정. 품절(isVariantSoldOut)만 보던 기존 게이트는
// "담은 수량 > 가용재고" 를 통과시켰고, 그대로 결제로 가면 cart.complete 의 재고예약이 실패했다.
describe("isVariantQuantityUnavailable", () => {
  it("담은 수량이 가용재고를 넘으면 불가로 본다", () => {
    expect(isVariantQuantityUnavailable({ ...tracked, inventory_quantity: 1 }, 2)).toBe(true)
  })

  it("가용재고와 같은 수량은 구매 가능하다", () => {
    expect(isVariantQuantityUnavailable({ ...tracked, inventory_quantity: 2 }, 2)).toBe(false)
  })

  it("품절(재고 0)은 기존 판정과 겹친다", () => {
    const variant = { ...tracked, inventory_quantity: 0 }
    expect(isVariantSoldOut(variant)).toBe(true)
    expect(isVariantQuantityUnavailable(variant, 1)).toBe(true)
  })

  it("재고관리를 안 하거나 백오더 허용이면 수량 제한이 없다", () => {
    expect(
      isVariantQuantityUnavailable({ manage_inventory: false, inventory_quantity: 0 }, 10)
    ).toBe(false)
    expect(
      isVariantQuantityUnavailable(
        { manage_inventory: true, allow_backorder: true, inventory_quantity: 0 },
        10
      )
    ).toBe(false)
  })

  it("variant 정보가 없으면 막지 않는다 (조회 실패로 구매를 막지 않기 위함)", () => {
    expect(isVariantQuantityUnavailable(undefined, 3)).toBe(false)
    expect(isVariantQuantityUnavailable(null, 3)).toBe(false)
  })
})
