import { describe, expect, it } from "vitest"
import { defaultTimeSaleSettings } from "@packages/domain-types/time-sale"
import { withBrandColors } from "./brand-colors"

describe("withBrandColors", () => {
  const branded = withBrandColors(defaultTimeSaleSettings())
  const all = [
    branded.styles.main.pc,
    branded.styles.main.mobile,
    branded.styles.more.pc,
    branded.styles.more.mobile,
  ].flatMap((layout) => layout.components)

  it("상품 목록의 시간 배지와 할인율을 pink-deep 으로 바꾼다", () => {
    const shelves = all.filter(
      (c) => c.type === "grid" || c.type === "carousel"
    )

    expect(shelves.length).toBeGreaterThan(0)
    for (const shelf of shelves) {
      expect(shelf.options.badgeColor).toBe("#c2306c")
      expect(shelf.options.discountCss?.color).toBe("#c2306c")
    }
  })

  it("밑줄 탭의 활성 밑줄은 mint, 알약 탭은 그대로 둔다", () => {
    const mainTabs = branded.styles.main.pc.components.find(
      (c) => c.type === "tabs"
    )
    const moreTabs = branded.styles.more.pc.components.find(
      (c) => c.type === "tabs"
    )

    expect(mainTabs?.options.activeTabCss).toMatchObject({
      color: "#141617",
      borderBottom: "2px solid #36c2b3",
    })
    expect(moreTabs?.options.activeTabCss).toEqual(
      defaultTimeSaleSettings().styles.more.pc.components.find(
        (c) => c.type === "tabs"
      )?.options.activeTabCss
    )
  })
})
