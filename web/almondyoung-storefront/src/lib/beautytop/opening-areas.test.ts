import { describe, expect, it } from "vitest"
import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { OPENING_CATEGORIES, OPENING_CATEGORY_KEYS, isOpeningArea, listOpeningAreas, openingPath } from "./opening-areas"

describe("opening radar areas", () => {
  it("keeps the indexable set bounded and unique", () => {
    const areas = listOpeningAreas()
    expect(areas).toHaveLength(100)
    expect(new Set(areas.map((a) => `${a.gugun}/${a.category}`)).size).toBe(areas.length)
  })

  it("accepts only listed combinations", () => {
    expect(isOpeningArea("마포구", "네일")).toBe(true)
    expect(isOpeningArea("마포구", "헤어")).toBe(false)
    expect(isOpeningArea("해운대구", "네일")).toBe(false)
    expect(isOpeningArea("마포구", "constructor")).toBe(false)
  })

  it("lists every mapped category exactly once", () => {
    expect([...OPENING_CATEGORY_KEYS].sort()).toEqual(Object.keys(OPENING_CATEGORIES).sort())
  })

  it("links every category to store categories that exist", () => {
    const keys = new Set<string>(FIXED_CATEGORIES.map((c) => c.key))
    for (const storeKeys of Object.values(OPENING_CATEGORIES)) {
      for (const key of storeKeys) expect(keys.has(key)).toBe(true)
    }
  })

  it("encodes Korean path segments", () => {
    expect(openingPath("마포구", "네일")).toBe(
      `/beautytop/opening/${encodeURIComponent("마포구")}/${encodeURIComponent("네일")}`
    )
  })
})
