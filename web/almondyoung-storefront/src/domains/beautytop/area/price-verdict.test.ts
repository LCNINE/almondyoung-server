import { describe, expect, it } from "vitest"
import { priceVerdict } from "./price-verdict"

const group = { min: 29000, median: 40000, max: 50000 }

describe("price ruler verdict", () => {
  it.each([
    [45000, "aboveMedian", 5000],
    [35000, "belowMedian", 5000],
    [40000, "atMedian", 0],
    [52000, "aboveMax", 2000],
    [27000, "belowMin", 2000],
    [50000, "aboveMedian", 10000],
  ])("%i원 → %s (%i)", (value, kind, diff) => {
    expect(priceVerdict(value, group)).toEqual({ kind, diff })
  })
})
