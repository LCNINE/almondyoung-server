import { describe, expect, it } from "vitest"
import {
  chronologicalPoints,
  observedChange,
  observedNumber,
  observedRate,
} from "./shop-data"

describe("observed shop data", () => {
  it("preserves an observed zero while withholding missing and invalid values", () => {
    expect(observedNumber(0)).toBe(0)
    for (const value of [null, undefined, NaN, Infinity, -1])
      expect(observedNumber(value)).toBeNull()
  })
  it("shows changes only when the source has comparable, consistent observations", () => {
    const metric = {
      key: "visitor_reviews",
      current: 12,
      previous: 10,
      delta: 2,
      status: "READY",
    }
    expect(observedChange(metric)).toBe(2)
    expect(observedChange({ ...metric, status: "NEED_BASELINE" })).toBeNull()
    expect(observedChange({ ...metric, status: "STALE" })).toBeNull()
    expect(observedChange({ ...metric, previous: null })).toBeNull()
    expect(observedChange({ ...metric, delta: 5 })).toBeNull()
    expect(observedChange({ ...metric, delta: NaN })).toBeNull()
    expect(observedChange({ ...metric, current: 8, delta: -2 })).toBe(-2)
  })
  it("withholds percentages without a valid nonzero baseline or consistent source calculation", () => {
    const metric = {
      key: "visitor_reviews",
      current: 12,
      previous: 10,
      delta: 2,
      rate_pct: 20,
      status: "READY",
    }
    expect(observedRate(metric)).toBe(20)
    expect(observedRate({ ...metric, rate_pct: 30 })).toBeNull()
    expect(observedRate({ ...metric, previous: 0, current: 2 })).toBeNull()
    expect(observedRate({ ...metric, rate_pct: null })).toBeNull()
    expect(observedRate({ ...metric, status: "STALE" })).toBeNull()
  })
  it("orders real observation dates without inventing missing observations or mutating the input", () => {
    const points = [
      { at: "2026-01-03", value: 3 },
      { at: "2026-01-01", value: 0 },
      { value: 10 },
      { at: "invalid", value: 4 },
      { at: "2026-01-02", value: NaN },
    ]
    expect(chronologicalPoints(points).map((point) => point.value)).toEqual([
      0, 3,
    ])
    expect(points[0].value).toBe(3)
  })
})
