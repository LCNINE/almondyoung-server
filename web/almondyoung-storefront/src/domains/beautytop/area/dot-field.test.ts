import { describe, expect, it } from "vitest"
import { layoutDots, MAX_DOTS } from "./dot-field"

const count = (dots: string[], kind: string) => dots.filter((d) => d === kind).length

describe("neighbourhood dot field", () => {
  it("draws one dot per shop and exactly the opened count", () => {
    const { perDot, dots } = layoutDots(300, 50, false)
    expect(perDot).toBe(1)
    expect(dots).toHaveLength(300)
    expect(count(dots, "new")).toBe(50)
  })

  it("reserves one dot for the visitor's own shop", () => {
    const { dots } = layoutDots(300, 50, true)
    expect(count(dots, "mine")).toBe(1)
    expect(dots).toHaveLength(300)
  })

  it("groups shops when a district is too dense to draw one by one", () => {
    const { perDot, dots } = layoutDots(2269, 300, false)
    expect(perDot).toBe(6)
    expect(dots.length).toBeLessThanOrEqual(MAX_DOTS)
    expect(count(dots, "new")).toBe(50)
  })

  it("handles empty and odd inputs", () => {
    expect(layoutDots(0, 5, true).dots).toEqual([])
    expect(count(layoutDots(10, 99, false).dots, "new")).toBe(10)
    expect(count(layoutDots(10, -3, false).dots, "new")).toBe(0)
  })
})
