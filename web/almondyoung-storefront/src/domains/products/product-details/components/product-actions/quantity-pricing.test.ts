import { describe, expect, it } from "vitest"
import { addedPriceChange, itemQuantityPricing } from "./quantity-pricing"

const NOW = new Date("2026-11-10T03:00:00.000Z")

const variantData = (calculated: number, original = 10000) => ({
    id: "v1",
    calculated_price: {
      calculated_amount: calculated,
      original_amount: original,
      currency_code: "krw",
    },
    metadata: {
      membershipPrice: 8000,
      tieredPrices: [
        { minQuantity: 3, price: 9500 },
        { minQuantity: 5, price: 9000 },
      ],
      membershipTieredPrices: [
        { minQuantity: 3, price: 7200 },
        { minQuantity: 5, price: 6800 },
      ],
    } as Record<string, unknown>,
  })
const variant = (calculated: number, original = 10000) =>
  variantData(calculated, original) as never

const product = { metadata: {} } as never
const guest = { isMember: false, hideMemberPrices: false, now: NOW }

describe("itemQuantityPricing", () => {
  it("prices one item at the current price and points to the next tier", () => {
    expect(itemQuantityPricing(variant(10000), product, 1, guest)).toEqual({
      unitPrice: 10000,
      currentPrice: 10000,
      appliedPercent: null,
      next: { addQuantity: 2, unitPrice: 9500, percent: 5 },
    })
  })

  it("applies the tier the quantity reaches", () => {
    expect(itemQuantityPricing(variant(10000), product, 4, guest)).toEqual({
      unitPrice: 9500,
      currentPrice: 10000,
      appliedPercent: 5,
      next: { addQuantity: 1, unitPrice: 9000, percent: 10 },
    })
  })

  it("uses member tiers for a member", () => {
    const pricing = itemQuantityPricing(variant(8000), product, 5, { ...guest, isMember: true })
    expect(pricing.unitPrice).toBe(6800)
    expect(pricing.next).toBeNull()
  })

  it("keeps the plain price for a product without tiers", () => {
    const plain = { ...variantData(10000), metadata: {} } as never
    expect(itemQuantityPricing(plain, product, 7, guest)).toEqual({
      unitPrice: 10000,
      currentPrice: 10000,
      appliedPercent: null,
      next: null,
    })
  })
})

describe("addedPriceChange", () => {
  it("warns when the cart charged more than the screen showed", () => {
    expect(addedPriceChange({ shown: 9500, added: 10000, hasTiers: true })).toEqual({ from: 9500, to: 10000 })
  })

  it("stays quiet when the tier price shown is what was charged", () => {
    expect(addedPriceChange({ shown: 9500, added: 9500, hasTiers: true })).toBeNull()
  })

  it("stays quiet when merging with the cart reached a better tier", () => {
    expect(addedPriceChange({ shown: 9500, added: 9000, hasTiers: true })).toBeNull()
  })

  it("still reports a lower price for a product without tiers", () => {
    expect(addedPriceChange({ shown: 4990, added: 4491, hasTiers: false })).toEqual({ from: 4990, to: 4491 })
  })

  it("ignores missing prices", () => {
    expect(addedPriceChange({ shown: 9500, added: null, hasTiers: true })).toBeNull()
  })
})
