import { describe, expect, it } from "vitest"
import { revenuePeriod } from "./revenue-period"

describe("revenue reference periods", () => {
  it("does not mislabel annual statistics as quarters", () => {
    expect(revenuePeriod("2024")).toEqual({ kind: "year", year: "2024" })
    expect(revenuePeriod("20244")).toEqual({
      kind: "quarter",
      year: "2024",
      quarter: "4",
    })
  })
  it("does not invent a quarter for an unknown period", () => {
    for (const period of ["", "20245", "202410", "unknown"])
      expect(revenuePeriod(period)).toEqual({ kind: "unknown" })
  })
})
