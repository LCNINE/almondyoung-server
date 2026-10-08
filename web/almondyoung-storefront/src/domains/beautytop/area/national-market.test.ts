import { describe, expect, it } from "vitest"
import { marketProvinces, sumProvinceMarkets } from "./national-market"

// Fictional counts only. Unsupported national aggregates reproduce the API contract.
const market = (
  sido: string,
  shops = 2,
  opened_last_year: number | undefined = 1
) => ({
  available: true,
  filters: { sido, gugun: "", category: "네일" },
  shops,
  opened_last_year,
  residents_per_shop: 100,
})

describe("national market aggregates", () => {
  it("uses every distinct province from options, without a fixed province count", () => {
    expect(
      marketProvinces({
        regions: [
          { sido: "예시 B", gugun: "구1" },
          { sido: "예시 A", gugun: "구1" },
          { sido: "예시 B", gugun: "구2" },
          { sido: "", gugun: "" },
        ],
        services: [],
      })
    ).toEqual(["예시 A", "예시 B"])
  })

  it("sums shop and opening counts but does not invent a national density", () => {
    const summary = sumProvinceMarkets(["예시 A", "예시 B"], "네일", [
      market("예시 A"),
      market("예시 B", 3, 2),
    ])
    expect(summary).toEqual({ available: true, shops: 5, opened_last_year: 3 })
    expect(summary.residents_per_shop).toBeUndefined()
  })

  it("retains real zero counts", () => {
    expect(
      sumProvinceMarkets(["예시 A"], "네일", [market("예시 A", 0, 0)]).shops
    ).toBe(0)
  })

  it("does not turn an unknown opening count into zero", () => {
    const { opened_last_year: _opened, ...unknown } = market("예시 B")
    expect(
      sumProvinceMarkets(["예시 A", "예시 B"], "네일", [
        market("예시 A"),
        unknown,
      ]).opened_last_year
    ).toBeUndefined()
  })

  it("rejects SELECT_REGION instead of interpreting it as no shops", () => {
    expect(() =>
      sumProvinceMarkets(["예시 A"], "네일", [
        { available: false, reason: "SELECT_REGION" },
      ])
    ).toThrow()
  })

  it("rejects incomplete, duplicate or empty coverage", () => {
    expect(() =>
      sumProvinceMarkets(["예시 A", "예시 B"], "네일", [market("예시 A")])
    ).toThrow()
    expect(() =>
      sumProvinceMarkets(["예시 A", "예시 A"], "네일", [
        market("예시 A"),
        market("예시 A"),
      ])
    ).toThrow()
    expect(() => sumProvinceMarkets([], "네일", [])).toThrow()
  })

  it("rejects mismatched province, district, category or missing provenance", () => {
    for (const filters of [
      { sido: "다른 지역", gugun: "", category: "네일" },
      { sido: "예시 A", gugun: "구1", category: "네일" },
      { sido: "예시 A", gugun: "", category: "헤어" },
      undefined,
    ]) {
      expect(() =>
        sumProvinceMarkets(["예시 A"], "네일", [
          { ...market("예시 A"), filters },
        ])
      ).toThrow()
    }
  })

  it("rejects invalid counts and unsafe totals", () => {
    for (const shops of [-1, NaN, Infinity, 1.5, undefined]) {
      expect(() =>
        sumProvinceMarkets(["예시 A"], "네일", [{ ...market("예시 A"), shops }])
      ).toThrow()
    }
    expect(() =>
      sumProvinceMarkets(["예시 A", "예시 B"], "네일", [
        market("예시 A", Number.MAX_SAFE_INTEGER),
        market("예시 B"),
      ])
    ).toThrow()
  })
})
