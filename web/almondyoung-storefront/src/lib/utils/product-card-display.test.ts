import { describe, expect, it } from "vitest"
import { resolveCardPriceDisplay } from "./product-card-display"

// 정가 10,000 / 멤버십가 8,000 인 상품. membershipSavings 는 정가 − 멤버십가.
const MEMBERSHIP_SAVINGS = 2000

describe("resolveCardPriceDisplay — 세일이 없을 때 (기존 동작 유지)", () => {
  it("미구독자는 정가를 보고 가입 유도 힌트를 받는다", () => {
    const result = resolveCardPriceDisplay({
      price: 10000,
      originalPrice: 10000,
      membershipSavings: MEMBERSHIP_SAVINGS,
      isMembership: false,
    })

    expect(result.displayPrice).toBe(10000)
    expect(result.displayOriginalPrice).toBeUndefined()
    expect(result.displayDiscount).toBe(0)
    expect(result.showMembershipHint).toBe(true)
    expect(result.membershipHintSavings).toBe(2000)
  })

  it("구독자는 멤버십가와 취소선 정가를 본다", () => {
    const result = resolveCardPriceDisplay({
      price: 8000,
      originalPrice: 10000,
      membershipSavings: MEMBERSHIP_SAVINGS,
      isMembership: true,
    })

    expect(result.displayPrice).toBe(8000)
    expect(result.displayOriginalPrice).toBe(10000)
    expect(result.displayDiscount).toBe(20)
    expect(result.showMembershipBadge).toBe(true)
    expect(result.showMembershipHint).toBe(false)
  })

  it("멤버십가가 없는 상품은 힌트도 뱃지도 없다", () => {
    const result = resolveCardPriceDisplay({
      price: 10000,
      originalPrice: 10000,
      isMembership: false,
    })

    expect(result.displayPrice).toBe(10000)
    expect(result.showMembershipHint).toBe(false)
    expect(result.showMembershipBadge).toBe(false)
  })
})

describe("resolveCardPriceDisplay — 타임세일 중", () => {
  // 예전 로직은 미구독자에게 originalPrice 를 그렸다. 그러면 할인율은 70% 인데 가격은 10,000 으로
  // 찍혀 세일가가 화면 어디에도 안 나온다.
  it("미구독자도 세일가를 본다", () => {
    const result = resolveCardPriceDisplay({
      price: 3000,
      originalPrice: 10000,
      membershipSavings: MEMBERSHIP_SAVINGS,
      isMembership: false,
    })

    expect(result.displayPrice).toBe(3000)
    expect(result.displayOriginalPrice).toBe(10000)
    expect(result.displayDiscount).toBe(70)
  })

  // 세일가가 멤버십가보다 싸면 "가입 시 절약" 은 거짓말이 된다. 그 시점의 멤버십 세일가는 이
  // 응답에 실리지 않으므로 틀린 금액을 보여주느니 숨긴다.
  it("세일가가 멤버십가보다 싸면 가입 유도 힌트를 숨긴다", () => {
    const result = resolveCardPriceDisplay({
      price: 3000,
      originalPrice: 10000,
      membershipSavings: MEMBERSHIP_SAVINGS,
      isMembership: false,
    })

    expect(result.showMembershipHint).toBe(false)
    expect(result.membershipHintSavings).toBeUndefined()
  })

  it("세일가가 멤버십가보다 비싸면 힌트는 그대로 뜬다", () => {
    const result = resolveCardPriceDisplay({
      price: 9000,
      originalPrice: 10000,
      membershipSavings: MEMBERSHIP_SAVINGS,
      isMembership: false,
    })

    expect(result.displayPrice).toBe(9000)
    expect(result.showMembershipHint).toBe(true)
    expect(result.membershipHintSavings).toBe(1000)
  })

  it("구독자는 멤버십 세일가를 본다", () => {
    const result = resolveCardPriceDisplay({
      price: 2400,
      originalPrice: 10000,
      membershipSavings: MEMBERSHIP_SAVINGS,
      isMembership: true,
    })

    expect(result.displayPrice).toBe(2400)
    expect(result.displayOriginalPrice).toBe(10000)
    expect(result.displayDiscount).toBe(76)
  })
})

describe("resolveCardPriceDisplay — 방어", () => {
  it("결제가가 0 이면 정가로 떨어진다", () => {
    const result = resolveCardPriceDisplay({ price: 0, originalPrice: 10000 })
    expect(result.displayPrice).toBe(10000)
    expect(result.displayDiscount).toBe(0)
  })

  it("정가가 0 이면 할인율을 계산하지 않는다", () => {
    const result = resolveCardPriceDisplay({ price: 0, originalPrice: 0 })
    expect(result.displayDiscount).toBe(0)
  })
})
