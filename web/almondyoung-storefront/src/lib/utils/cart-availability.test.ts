import { describe, expect, it } from "vitest"
import { isVariantQuantityUnavailable, isVariantSoldOut } from "./cart-availability"

// 담기 시점엔 통과했다가 결제 직전에 부족해지는 라인을 가려내는 판정.
// 품절(isVariantSoldOut)만 보던 기존 게이트는 이 케이스를 통과시켰고, 그대로 결제로 가면
// cart.complete 의 재고예약이 실패해 주문이 생성되지 않았다.
describe("isVariantQuantityUnavailable", () => {
  const tracked = { manage_inventory: true, allow_backorder: false }

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
