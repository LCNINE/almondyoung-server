import { describe, expect, it } from "vitest"
import {
  cartLineTierInfo,
  msUntilNextBoundary,
  orderLineQuantityDiscount,
  nextTier,
  readTiers,
  splitLineDiscount,
  tierRows,
  unitPriceFor,
} from "./quantity-discount"

const NOW = new Date("2026-11-10T03:00:00.000Z")

const variantMeta = {
  membershipPrice: 8000,
  tieredPrices: [
    { minQuantity: 3, price: 9500 },
    { minQuantity: 5, price: 9000 },
  ],
  membershipTieredPrices: [
    { minQuantity: 3, price: 7200 },
    { minQuantity: 5, price: 6800 },
  ],
}

const always = { quantityDiscount: null }

describe("readTiers", () => {
  it("reads regular and member tiers sorted by quantity", () => {
    const tiers = readTiers(
      { ...variantMeta, tieredPrices: [...variantMeta.tieredPrices].reverse() },
      always,
      NOW
    )
    expect(tiers.regular.map((t) => t.minQuantity)).toEqual([3, 5])
    expect(tiers.membership).toEqual(variantMeta.membershipTieredPrices)
  })

  it("drops tiers outside the discount period", () => {
    const before = readTiers(
      variantMeta,
      { quantityDiscount: { startsAt: "2026-11-10T15:00:00.000Z", endsAt: null } },
      NOW
    )
    const after = readTiers(
      variantMeta,
      { quantityDiscount: { startsAt: null, endsAt: "2026-11-10T02:59:59.999Z" } },
      NOW
    )
    const during = readTiers(
      variantMeta,
      {
        quantityDiscount: {
          startsAt: "2026-11-09T15:00:00.000Z",
          endsAt: "2026-11-10T14:59:59.999Z",
        },
      },
      NOW
    )
    expect(before.regular).toEqual([])
    expect(after.membership).toEqual([])
    expect(during.regular).toHaveLength(2)
  })

  it("ignores malformed metadata", () => {
    const tiers = readTiers(
      {
        tieredPrices: [{ minQuantity: "3", price: 9500 }, { minQuantity: 4 }, null],
        membershipTieredPrices: "nope",
      },
      { quantityDiscount: { startsAt: "not a date" } },
      NOW
    )
    expect(tiers).toEqual({ regular: [], membership: [] })
  })

  it("treats a product without a period as always on", () => {
    expect(readTiers(variantMeta, undefined, NOW).regular).toHaveLength(2)
  })
})

describe("unitPriceFor", () => {
  const tiers = readTiers(variantMeta, always, NOW)

  it("charges a non-member the regular tier price", () => {
    expect([1, 2, 3, 4, 5, 10].map((q) => unitPriceFor(q, 10000, tiers, false))).toEqual([
      10000, 10000, 9500, 9500, 9000, 9000,
    ])
  })

  it("charges a member the cheapest of the member price and both tiers", () => {
    expect([1, 3, 5].map((q) => unitPriceFor(q, 8000, tiers, true))).toEqual([
      8000, 7200, 6800,
    ])
  })

  it("keeps a lower current price such as a sale", () => {
    expect(unitPriceFor(5, 8500, tiers, false)).toBe(8500)
  })
})

describe("tierRows", () => {
  const tiers = readTiers(variantMeta, always, NOW)

  it("lists each tier with its unit price and whole-percent saving for a non-member", () => {
    expect(tierRows(10000, tiers, { isMember: false, hideMemberPrices: false })).toEqual([
      { minQuantity: 3, unitPrice: 9500, percent: 5, memberUnitPrice: 7200 },
      { minQuantity: 5, unitPrice: 9000, percent: 10, memberUnitPrice: 6800 },
    ])
  })

  it("hides member prices when the product keeps them for members", () => {
    const rows = tierRows(10000, tiers, { isMember: false, hideMemberPrices: true })
    expect(rows.every((r) => r.memberUnitPrice === undefined)).toBe(true)
  })

  it("shows a member their own tier prices against the member price", () => {
    expect(tierRows(8000, tiers, { isMember: true, hideMemberPrices: false })).toEqual([
      { minQuantity: 3, unitPrice: 7200, percent: 10 },
      { minQuantity: 5, unitPrice: 6800, percent: 15 },
    ])
  })

  it("leaves out tiers that are not cheaper than the current price", () => {
    const legacy = readTiers(
      {
        tieredPrices: [
          { minQuantity: 2, price: 13000 },
          { minQuantity: 3, price: 26000 },
        ],
      },
      always,
      NOW
    )
    expect(tierRows(15900, legacy, { isMember: false, hideMemberPrices: false })).toEqual([
      { minQuantity: 2, unitPrice: 13000, percent: 18 },
    ])
  })
})

describe("nextTier", () => {
  const rows = tierRows(10000, readTiers(variantMeta, always, NOW), {
    isMember: false,
    hideMemberPrices: false,
  })

  it("tells how many more reach the next tier", () => {
    expect(nextTier(1, rows)).toEqual({ addQuantity: 2, unitPrice: 9500, percent: 5 })
    expect(nextTier(4, rows)).toEqual({ addQuantity: 1, unitPrice: 9000, percent: 10 })
  })

  it("returns nothing at the last tier", () => {
    expect(nextTier(5, rows)).toBeNull()
  })
})

describe("splitLineDiscount", () => {
  const line = (unit: number, quantity: number, compareAt: number | null = 10000) => ({
    unit_price: unit,
    compare_at_unit_price: compareAt,
    quantity,
    variant: { metadata: variantMeta },
    product: { metadata: always },
  })

  it("counts a non-member's tier price as quantity discount only", () => {
    expect(splitLineDiscount(line(9500, 3), { isMember: false, isTimeSale: false, now: NOW })).toEqual({
      quantityDiscount: 1500,
      otherDiscount: 0,
    })
  })

  it("splits a member line into membership and quantity parts", () => {
    expect(splitLineDiscount(line(7200, 3), { isMember: true, isTimeSale: false, now: NOW })).toEqual({
      quantityDiscount: 2400,
      otherDiscount: 6000,
    })
  })

  it("keeps a line below the tier as before", () => {
    expect(splitLineDiscount(line(8000, 2), { isMember: true, isTimeSale: false, now: NOW })).toEqual({
      quantityDiscount: 0,
      otherDiscount: 4000,
    })
  })

  it("does not split a time-sale line", () => {
    expect(splitLineDiscount(line(9500, 3), { isMember: false, isTimeSale: true, now: NOW })).toEqual({
      quantityDiscount: 0,
      otherDiscount: 1500,
    })
  })

  it("does not split when the unit price is not the tier price", () => {
    expect(splitLineDiscount(line(9400, 3), { isMember: false, isTimeSale: false, now: NOW })).toEqual({
      quantityDiscount: 0,
      otherDiscount: 1800,
    })
  })

  it("returns nothing without a compare-at price", () => {
    expect(splitLineDiscount(line(9500, 3, null), { isMember: false, isTimeSale: false, now: NOW })).toEqual({
      quantityDiscount: 0,
      otherDiscount: 0,
    })
  })
})

describe("cartLineTierInfo", () => {
  const line = (unit: number, quantity: number) => ({
    unit_price: unit,
    compare_at_unit_price: 10000,
    quantity,
    variant: { metadata: variantMeta },
    product: { metadata: always },
  })
  const guest = { isMember: false, isTimeSale: false, now: NOW }

  it("shows the saving and the next tier for a line inside a tier", () => {
    expect(cartLineTierInfo(line(9500, 3), guest)).toEqual({
      quantityDiscount: 1500,
      next: { addQuantity: 2, unitPrice: 9000, percent: 10 },
    })
  })

  it("points a one-item line to the first tier", () => {
    expect(cartLineTierInfo(line(10000, 1), guest)).toEqual({
      quantityDiscount: 0,
      next: { addQuantity: 2, unitPrice: 9500, percent: 5 },
    })
  })

  it("uses the member price as the starting point for a member", () => {
    expect(cartLineTierInfo(line(8000, 1), { ...guest, isMember: true })).toEqual({
      quantityDiscount: 0,
      next: { addQuantity: 2, unitPrice: 7200, percent: 10 },
    })
  })

  it("does not suggest anything on a time-sale line", () => {
    expect(cartLineTierInfo(line(7000, 1), { ...guest, isTimeSale: true })).toEqual({
      quantityDiscount: 0,
      next: null,
    })
  })
})

describe("orderLineQuantityDiscount", () => {
  const item = (breakdown: unknown, quantity = 3) => ({ quantity, metadata: { price_breakdown: breakdown } })

  it("multiplies the recorded per-unit saving by the quantity", () => {
    expect(
      orderLineQuantityDiscount(item({ base_unit: 10000, before_tier_unit: 10000, tier_discount_unit: 500 }))
    ).toBe(1500)
  })

  it("is zero for an order line without a recorded breakdown", () => {
    expect(orderLineQuantityDiscount({ quantity: 3, metadata: null })).toBe(0)
    expect(orderLineQuantityDiscount(item({ tier_discount_unit: "500" }))).toBe(0)
    expect(orderLineQuantityDiscount(item({ tier_discount_unit: -10 }))).toBe(0)
  })
})

describe("msUntilNextBoundary", () => {
  const meta = (startsAt: string | null, endsAt: string | null) => ({ quantityDiscount: { startsAt, endsAt } })

  it("waits until the period starts", () => {
    expect(msUntilNextBoundary([meta("2026-11-10T03:00:10.000Z", null)], NOW)).toBe(10_000)
  })

  it("waits until just after the last included instant of the period", () => {
    expect(msUntilNextBoundary([meta(null, "2026-11-10T03:00:04.999Z")], NOW)).toBe(5_000)
  })

  it("takes the earliest boundary across products", () => {
    expect(
      msUntilNextBoundary(
        [meta(null, "2026-11-10T03:01:00.000Z"), meta("2026-11-10T03:00:30.000Z", null), { quantityDiscount: null }],
        NOW
      )
    ).toBe(30_000)
  })

  it("returns null when every boundary has passed or there is no period", () => {
    expect(msUntilNextBoundary([meta("2026-11-09T00:00:00.000Z", "2026-11-10T02:00:00.000Z"), undefined], NOW)).toBeNull()
  })

  it("caps far-away boundaries to what a timer can hold", () => {
    expect(msUntilNextBoundary([meta("2099-01-01T00:00:00.000Z", null)], NOW)).toBe(2_147_483_647)
  })
})
