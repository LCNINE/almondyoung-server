import { describe, expect, it } from "vitest"
import { earliestEnd, orderedProducts, paginate, productEndsAt } from "./time-sale-merge"

const sale = (id: string, endsAt: string, productIds: string[]) => ({
  id,
  startsAt: "2030-01-01T00:00:00.000Z",
  endsAt,
  priceListIds: [`pl_${id}`],
  productIds,
})

describe("earliestEnd", () => {
  it("returns the soonest end across sales", () => {
    expect(
      earliestEnd([sale("a", "2030-01-09T00:00:00.000Z", []), sale("b", "2030-01-05T00:00:00.000Z", [])])
    ).toBe("2030-01-05T00:00:00.000Z")
  })

  it("returns null without sales", () => {
    expect(earliestEnd([])).toBeNull()
  })
})

describe("productEndsAt", () => {
  it("uses the earlier end when a product is in two sales", () => {
    const map = productEndsAt([
      sale("a", "2030-01-09T00:00:00.000Z", ["p1", "p2"]),
      sale("b", "2030-01-05T00:00:00.000Z", ["p2"]),
    ])
    expect(map.get("p1")).toBe("2030-01-09T00:00:00.000Z")
    expect(map.get("p2")).toBe("2030-01-05T00:00:00.000Z")
  })
})

describe("orderedProducts", () => {
  it("uses the server order when products is present", () => {
    expect(
      orderedProducts({
        sales: [sale("a", "2030-01-09T00:00:00.000Z", ["p1", "p2"])],
        products: [
          { id: "p2", categoryIds: ["c1"] },
          { id: "p1", categoryIds: [] },
        ],
      }).map((p) => p.id)
    ).toEqual(["p2", "p1"])
  })

  it("falls back when products is missing", () => {
    expect(
      orderedProducts({
        sales: [sale("a", "2030-01-09T00:00:00.000Z", ["p1", "p2"]), sale("b", "2030-01-05T00:00:00.000Z", ["p2", "p3"])],
      })
    ).toEqual([
      { id: "p1", categoryIds: [] },
      { id: "p2", categoryIds: [] },
      { id: "p3", categoryIds: [] },
    ])
  })
})

describe("paginate", () => {
  it("clamps the page into range", () => {
    const items = Array.from({ length: 85 }, (_, i) => i)
    expect(paginate(items, 3, 40)).toEqual({ items: items.slice(80), page: 3, totalPages: 3 })
    expect(paginate(items, 99, 40).page).toBe(3)
    expect(paginate(items, 0, 40).page).toBe(1)
    expect(paginate([], 1, 40)).toEqual({ items: [], page: 1, totalPages: 1 })
  })
})
