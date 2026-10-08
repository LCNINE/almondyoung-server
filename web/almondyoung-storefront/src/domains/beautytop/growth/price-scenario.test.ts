import { describe, expect, it } from "vitest"
import { calculatePriceScenario } from "./price-scenario"

const input = {
  currentPrice: 40_000,
  nextPrice: 45_000,
  visits: 100,
  variableCost: 5_000,
  minutes: 60,
}

describe("Price change scenario", () => {
  it("rounds required visits up so the resulting revenue actually meets the baseline", () => {
    const result = calculatePriceScenario(input)
    expect(result).toMatchObject({
      currentRevenue: 4_000_000,
      nextRevenue: 4_500_000,
      revenueBreakEvenVisits: 89,
      currentContribution: 3_500_000,
      nextContribution: 4_000_000,
      contributionBreakEvenVisits: 88,
      hourlyContribution: 40_000,
    })
    expect(89 * input.nextPrice).toBeGreaterThanOrEqual(
      input.currentPrice * input.visits
    )
    expect(88 * input.nextPrice).toBeLessThan(input.currentPrice * input.visits)
  })
  it("shows additional visits needed when lowering the price", () => {
    expect(
      calculatePriceScenario({ ...input, nextPrice: 30_000 })
        ?.revenueBreakEvenVisits
    ).toBe(134)
  })
  it("does not invent a zero cost or service duration when they were not entered", () => {
    expect(
      calculatePriceScenario({ ...input, variableCost: null, minutes: null })
    ).toMatchObject({
      currentContribution: null,
      nextContribution: null,
      contributionBreakEvenVisits: null,
      hourlyContribution: null,
    })
    expect(
      calculatePriceScenario({ ...input, variableCost: 0 })?.nextContribution
    ).toBe(4_500_000)
  })
  it("does not suggest a profitable visit target when per-visit contribution is non-positive", () => {
    expect(
      calculatePriceScenario({ ...input, variableCost: 50_000 })
    ).toMatchObject({
      nextContribution: -500_000,
      contributionBreakEvenVisits: null,
    })
  })
  it.each([
    { currentPrice: 0 },
    { nextPrice: -1 },
    { visits: 1.5 },
    { visits: Infinity },
    { minutes: 0 },
    { variableCost: -1 },
    { nextPrice: 10_000_001 },
    { currentPrice: NaN },
  ])("rejects invalid assumptions %j", (invalid) => {
    expect(calculatePriceScenario({ ...input, ...invalid })).toBeNull()
  })
})
