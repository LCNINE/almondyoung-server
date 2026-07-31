import { describe, expect, it } from "vitest"
import {
  describeStockShortage,
  getAvailableQuantity,
  isInsufficientInventoryError,
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

  it("재고가 0 이면 어떤 수량이든 초과다", () => {
    expect(describeStockShortage({ available: 0, quantity: 1 })).toBe("exceeds-stock")
  })

  it("남은 재고를 모르는 화면은 수량 없는 일반 안내로 떨어진다", () => {
    expect(describeStockShortage({})).toBe("unknown")
    expect(describeStockShortage({ available: null, quantity: 3 })).toBe("unknown")
  })

  it("수량을 안 넘기면 1개 담기로 본다", () => {
    expect(describeStockShortage({ available: 0 })).toBe("exceeds-stock")
    expect(describeStockShortage({ available: 1 })).toBe("cart-sum")
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
