import { describe, expect, it } from "vitest"
import type { BeautyTopProcedure } from "../types"
import {
  menuPercent,
  observedMenus,
  observedCount,
  observedPercent,
} from "./trends-observations"

// Fictional observations with the same readiness contract as the API.
const row: BeautyTopProcedure = {
  id: "example",
  name: "Example service",
  category: "네일",
  adoption: { ready: false, current_shops: 2, checked_shops: 5 },
  mentions: { ready: true, shops: 2, share_percent: 40 },
  regional: { ready: false, local_percent: 40, national_percent: 50 },
  growth: { ready: false, change_pp: null },
}

describe("observed menus", () => {
  it("retains current observations when historical comparison is not ready", () => {
    expect(
      observedMenus({ procedures: { available: true, rows: [row] } }, "네일")
    ).toEqual([row])
    expect(menuPercent(row)).toBeNull()
  })
  it("does not use an ungated regional percentage", () => {
    expect(
      menuPercent({ ...row, adoption: { ...row.adoption, ready: true } })
    ).toBe(40)
    expect(
      menuPercent({ ...row, regional: { ...row.regional, ready: true } })
    ).toBe(40)
  })
  it("does not confuse zero observations with unavailable observations", () => {
    const zero = { ...row, adoption: { ...row.adoption, current_shops: 0 } }
    expect(
      observedMenus({ procedures: { available: true, rows: [zero] } }, "네일")
    ).toEqual([zero])
    expect(
      observedMenus({ procedures: { available: false, rows: [row] } }, "네일")
    ).toEqual([])
  })
  it("rejects wrong categories and invalid denominators", () => {
    for (const adoption of [
      { ready: true, current_shops: 1, checked_shops: 0 },
      { ready: true, current_shops: 6, checked_shops: 5 },
      { ready: true, current_shops: -1, checked_shops: 5 },
      { ready: true, current_shops: NaN, checked_shops: 5 },
    ]) {
      expect(
        observedMenus(
          { procedures: { available: true, rows: [{ ...row, adoption }] } },
          "네일"
        )
      ).toEqual([])
      expect(menuPercent({ ...row, adoption })).toBeNull()
    }
    expect(
      observedMenus({ procedures: { available: true, rows: [row] } }, "헤어")
    ).toEqual([])
  })
  it("only accepts observed finite counts and bounded percentages", () => {
    for (const value of [undefined, null, NaN, Infinity, -1, 1.5])
      expect(observedCount(value)).toBe(false)
    for (const value of [undefined, null, NaN, Infinity, -1, 101])
      expect(observedPercent(value)).toBe(false)
    expect(observedCount(0)).toBe(true)
    expect(observedPercent(0)).toBe(true)
  })
})
