import { describe, expect, it } from "vitest"
import { resolveQuantityChange } from "./cart-quantity"

describe("resolveQuantityChange", () => {
  it("상한이 없으면 요청한 수량을 그대로 쓴다", () => {
    expect(
      resolveQuantityChange({ requested: 30, current: 1, maxQuantity: undefined })
    ).toEqual({ type: "apply", quantity: 30, clampedToMax: false })
  })

  it("상한 안쪽이면 요청한 수량을 그대로 쓴다", () => {
    expect(
      resolveQuantityChange({ requested: 3, current: 2, maxQuantity: 5 })
    ).toEqual({ type: "apply", quantity: 3, clampedToMax: false })
  })

  it("상한을 넘겨 늘리려 하면 남은 수량과 함께 막는다", () => {
    expect(
      resolveQuantityChange({ requested: 6, current: 5, maxQuantity: 5 })
    ).toEqual({ type: "reject", reason: "exceedsMax", max: 5 })
  })

  it("이미 상한을 넘긴 라인에서 한 칸 줄이면 상한까지 내려간다", () => {
    expect(
      resolveQuantityChange({ requested: 9, current: 10, maxQuantity: 5 })
    ).toEqual({ type: "apply", quantity: 5, clampedToMax: true })
  })

  it("이미 상한을 넘긴 라인에서 상한보다 큰 수량을 입력해도 상한까지 내려간다", () => {
    expect(
      resolveQuantityChange({ requested: 7, current: 10, maxQuantity: 5 })
    ).toEqual({ type: "apply", quantity: 5, clampedToMax: true })
  })

  it("상한을 넘긴 라인에서 상한 이하로 줄이는 건 그대로 통과시킨다", () => {
    expect(
      resolveQuantityChange({ requested: 2, current: 10, maxQuantity: 5 })
    ).toEqual({ type: "apply", quantity: 2, clampedToMax: false })
  })

  it("품절이면 줄이는 요청도 보내지 않는다", () => {
    expect(
      resolveQuantityChange({ requested: 4, current: 5, maxQuantity: 0 })
    ).toEqual({ type: "reject", reason: "soldOut", isIncrease: false })
  })

  // 품절 라인에서 "-" 를 눌렀는데 "늘릴 수 없어요" 가 뜨면 고객이 뭘 해야 할지 알 수 없다.
  it("품절 거절은 늘리려던 것인지 줄이려던 것인지 구분해 돌려준다", () => {
    expect(
      resolveQuantityChange({ requested: 6, current: 5, maxQuantity: 0 })
    ).toEqual({ type: "reject", reason: "soldOut", isIncrease: true })
  })

  it("1개 미만은 보내지 않는다", () => {
    expect(
      resolveQuantityChange({ requested: 0, current: 1, maxQuantity: 5 })
    ).toEqual({ type: "reject", reason: "belowMin" })
    expect(
      resolveQuantityChange({ requested: NaN, current: 1, maxQuantity: 5 })
    ).toEqual({ type: "reject", reason: "belowMin" })
  })
})
