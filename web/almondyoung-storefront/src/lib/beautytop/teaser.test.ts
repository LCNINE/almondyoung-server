import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }))
import { normalizeSearchArea, normalizeSearchTerm, parseShopId, summarizeTeaser, toTeaserShops } from "./teaser"

const metric = (over: Record<string, unknown>) => ({
  key: "reviews", label: "리뷰", current: 130, median: 115, rank: 2, rank_total: 6,
  order: "높은 수치순", status: "READY", ...over,
})

const briefing = {
  brand: { id: 1, name: "Fixture Shop" },
  peers: {
    items: [{ id: 2, name: "Neighbour Alpha", values: { reviews: 777 } }],
    metrics: [
      metric({}),
      metric({ key: "followers", current: 190, median: 1276, rank: 21, rank_total: 24 }),
      metric({ key: "cadence", current: null, median: null, rank: null, rank_total: null, order: "짧은 간격순", status: "SMALL_SAMPLE" }),
      metric({ key: "price", current: 45000, median: 49000, rank: 4, rank_total: 5 }),
    ],
  },
}
const position = {
  brand: { id: 1, name: "Fixture Shop", visitor_reviews: 130 },
  ranks: [
    { label: "전국", rank: 7548, total: 13586, average: 413.07 },
    { label: "우리 동네 같은 업종", rank: 8, total: 16, average: 210.75 },
  ],
}

describe("BeautyTop preview for non-members", () => {
  it("counts metrics by direction and keeps price and thin samples apart", () => {
    expect(summarizeTeaser(briefing, position).metrics).toEqual({
      ahead: 1, behind: 1, even: 0, pricePosition: 1, unknown: 1,
    })
  })

  it("treats a shorter interval as ahead and an exact median as even", () => {
    const summary = summarizeTeaser({ peers: { metrics: [
      metric({ key: "cadence", current: 3, median: 5, order: "짧은 간격순" }),
      metric({ key: "cadence", current: 7, median: 5, order: "짧은 간격순" }),
      metric({ current: 115, median: 115 }),
    ] } }, position)
    expect(summary.metrics).toMatchObject({ ahead: 1, behind: 1, even: 1 })
  })

  it("never carries ranks, values or other shops' names", () => {
    const body = JSON.stringify(summarizeTeaser(briefing, position))
    expect(body).toBe(JSON.stringify({
      scopes: [{ label: "전국", total: 13586 }, { label: "우리 동네 같은 업종", total: 16 }],
      metrics: { ahead: 1, behind: 1, even: 0, pricePosition: 1, unknown: 1 },
    }))
    for (const leaked of ["7548", "\"rank\"", "Neighbour", "Fixture", "45000", "1276", "210.75", "777"]) {
      expect(body).not.toContain(leaked)
    }
  })

  it("survives missing or malformed source data", () => {
    expect(summarizeTeaser(null, undefined)).toEqual({
      scopes: [], metrics: { ahead: 0, behind: 0, even: 0, pricePosition: 0, unknown: 0 },
    })
    expect(summarizeTeaser({ peers: { metrics: [null, 3] } }, { ranks: [{ label: 1 }] }).metrics.unknown).toBe(2)
  })

  it("lists shops with location only, at most ten", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1, name: `Shop ${i}`, sido: "서울", gugun: "마포구", category: "네일", entity_type: "SHOP",
      followers: 999, visitor_reviews: 555, overall_score: 49.5,
    }))
    const shops = toTeaserShops({ items: [...items, { id: 99, name: "Brand", entity_type: "BRAND" }] })
    expect(shops).toHaveLength(10)
    expect(Object.keys(shops[0]).sort()).toEqual(["category", "gugun", "id", "name", "sido"])
  })

  it("accepts only sane search terms and numeric ids", () => {
    expect(normalizeSearchTerm(" 네일 ")).toBe("네일")
    expect(normalizeSearchTerm("네")).toBeNull()
    expect(normalizeSearchTerm("가".repeat(41))).toBeNull()
    expect(normalizeSearchArea(" 서울 ", "마포구")).toEqual({ sido: "서울", gugun: "마포구" })
    for (const [a, b] of [[null, "마포구"], ["서울", ""], ["서울", "가".repeat(41)]]) expect(normalizeSearchArea(a, b)).toBeNull()
    expect(parseShopId("4321")).toBe(4321)
    for (const bad of [null, "", "0", "-1", "1.5", "1e3", "12345678901", "__proto__"]) expect(parseShopId(bad)).toBeNull()
  })
})
