import { describe, expect, it } from "vitest"
import { resolveExpiryDisplay } from "./coupon-expiry"

describe("resolveExpiryDisplay", () => {
  it("expires_at 이 있으면 날짜 표시다", () => {
    expect(
      resolveExpiryDisplay({ expires_at: "2026-12-31T00:00:00.000Z", validity_days: 30 })
    ).toEqual({ kind: "dated", date: "2026-12-31T00:00:00.000Z" })
  })

  it("미발급 + validity_days 있으면 「발급 후 N일」이다", () => {
    expect(
      resolveExpiryDisplay({ expires_at: null, validity_days: 30, is_assigned: false })
    ).toEqual({ kind: "daysAfterClaim", days: 30 })
  })

  it("발급된 쿠폰이면 validity_days 가 있어도 무기한 표시다 — 만료는 이미 링크 행이 확정했다", () => {
    expect(
      resolveExpiryDisplay({ expires_at: null, validity_days: 30, is_assigned: true })
    ).toEqual({ kind: "unlimited" })
  })

  it("expires_at 도 validity_days 도 없으면 무기한이다", () => {
    expect(resolveExpiryDisplay({ expires_at: null, validity_days: null })).toEqual({
      kind: "unlimited",
    })
  })

  it("validity_days 가 0 이하면 무기한으로 접는다 — 방어적", () => {
    expect(
      resolveExpiryDisplay({ expires_at: null, validity_days: 0, is_assigned: false })
    ).toEqual({ kind: "unlimited" })
  })

  it("is_assigned 를 생략하면 미발급으로 취급한다", () => {
    expect(resolveExpiryDisplay({ expires_at: null, validity_days: 7 })).toEqual({
      kind: "daysAfterClaim",
      days: 7,
    })
  })
})
