import { describe, expect, it } from "vitest"
import { calculateCartDiscount } from "./calculate-discount"

const NOW = new Date("2026-11-10T03:00:00.000Z")

const tierLine = (unit: number, quantity: number) => ({
  id: `line-${unit}-${quantity}`,
  unit_price: unit,
  compare_at_unit_price: 10000,
  quantity,
  variant: {
    metadata: {
      membershipPrice: 8000,
      tieredPrices: [{ minQuantity: 3, price: 9500 }],
      membershipTieredPrices: [{ minQuantity: 3, price: 7200 }],
    },
  },
  product: { metadata: {} },
})

const plainLine = { id: "plain", unit_price: 8000, compare_at_unit_price: 10000, quantity: 1 }

const guest = { isMember: false, isTimeSaleLine: () => false, now: NOW }

describe("calculateCartDiscount", () => {
  it("keeps the old total as one discount when no context is given", () => {
    expect(calculateCartDiscount([tierLine(9500, 3)])).toEqual({
      originalTotal: 30000,
      membershipDiscount: 1500,
      quantityDiscount: 0,
      itemCount: 3,
    })
  })

  it("moves a non-member's tier saving out of the membership discount", () => {
    const result = calculateCartDiscount([tierLine(9500, 3)], guest)
    expect(result.membershipDiscount).toBe(0)
    expect(result.quantityDiscount).toBe(1500)
  })

  it("splits a member's line into membership and quantity parts", () => {
    const result = calculateCartDiscount([tierLine(7200, 3), plainLine], { ...guest, isMember: true })
    expect(result.membershipDiscount).toBe(6000 + 2000)
    expect(result.quantityDiscount).toBe(2400)
  })

  it("leaves a time-sale line as it was", () => {
    const result = calculateCartDiscount([tierLine(9500, 3)], { ...guest, isTimeSaleLine: () => true })
    expect(result).toMatchObject({ membershipDiscount: 1500, quantityDiscount: 0 })
  })

  it("keeps the totals of a cart without tiers", () => {
    expect(calculateCartDiscount([plainLine], guest)).toEqual({
      originalTotal: 10000,
      membershipDiscount: 2000,
      quantityDiscount: 0,
      itemCount: 1,
    })
  })
})
