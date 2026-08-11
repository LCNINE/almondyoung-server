import { describe, expect, it } from "vitest"
import { DEFAULT_RANGE_MONTHS, getDefaultRange } from "./default-range"

describe("getDefaultRange", () => {
  it("현재 달을 포함해 6개월을 덮는다", () => {
    const { from, to } = getDefaultRange(new Date(2026, 7, 11))

    expect(from).toEqual(new Date(2026, 2, 1))
    expect(to.getFullYear()).toBe(2026)
    expect(to.getMonth()).toBe(7)
    expect(to.getDate()).toBe(31)

    const months =
      (to.getFullYear() - from.getFullYear()) * 12 +
      (to.getMonth() - from.getMonth()) +
      1
    expect(months).toBe(DEFAULT_RANGE_MONTHS)
  })

  it("연도를 넘어가도 6개월을 유지한다", () => {
    const { from, to } = getDefaultRange(new Date(2026, 1, 5))

    expect(from).toEqual(new Date(2025, 8, 1))
    expect(to.getMonth()).toBe(1)
    expect(to.getDate()).toBe(28)
  })
})
