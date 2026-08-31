import { describe, expect, it } from "vitest"
import { maxPossibleDiscount, shouldShowCap } from "./coupon-discount"

const percentage = { type: "percentage", value: 10 }
const fixed = { type: "fixed", value: 50000 }

describe("shouldShowCap", () => {
  it("정률 + 캡이면 표기한다", () => {
    expect(shouldShowCap(percentage, 3000)).toBe(true)
  })
  it("캡이 없으면 표기하지 않는다", () => {
    expect(shouldShowCap(percentage, null)).toBe(false)
  })
  it("정액에는 캡이 있어도 표기하지 않는다", () => {
    expect(shouldShowCap(fixed, 3000)).toBe(false)
  })
  it("할인 정보 자체가 없으면 표기하지 않는다", () => {
    expect(shouldShowCap(null, 3000)).toBe(false)
  })
  it("캡 0 도 캡이다", () => {
    expect(shouldShowCap(percentage, 0)).toBe(true)
  })
})

describe("maxPossibleDiscount — 「할인 큰 순」 정렬 키", () => {
  it("정액은 할인액 자신이다", () => {
    expect(maxPossibleDiscount(fixed, null)).toBe(50000)
  })
  it("상한 있는 정률은 상한이다", () => {
    expect(maxPossibleDiscount(percentage, 3000)).toBe(3000)
  })
  it("상한 없는 정률은 무한이다 — 장바구니가 커질수록 커진다", () => {
    expect(maxPossibleDiscount(percentage, null)).toBe(Number.POSITIVE_INFINITY)
  })
  it("할인 정보가 없으면 0 이다", () => {
    expect(maxPossibleDiscount(null, null)).toBe(0)
  })

  it("🔴 회귀: 「10% 최대 3천원」은 「5만원 정액」보다 작다", () => {
    expect(maxPossibleDiscount(percentage, 3000)).toBeLessThan(
      maxPossibleDiscount(fixed, null)
    )
  })
})
