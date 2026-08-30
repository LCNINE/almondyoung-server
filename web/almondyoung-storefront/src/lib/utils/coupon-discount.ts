/**
 * 쿠폰 할인 표기·정렬의 공통 판정 (#488 A4).
 *
 * 라벨 자체는 화면마다 i18n 네임스페이스가 달라(`mypage.coupon` · `checkout.discount` ·
 * `couponClaim`) 여기서 만들지 않는다. **번역이 필요 없는 판정만** 여기 둔다 — 그래야
 * vitest 가 닿는다(`.tsx` 안의 삼항 연산자는 어떤 러너도 안 본다).
 */

export type CouponDiscountLike = {
  type: string
  value: number
}

/**
 * 「최대 N원」을 붙여야 하는가.
 *
 * 정액 쿠폰의 상한은 할인액 자신이라 표기가 중복이다. 정률일 때만 의미가 있다.
 * `0` 도 상한이므로 falsy 판정으로 흘리지 않는다.
 */
export function shouldShowCap(
  discount: CouponDiscountLike | null | undefined,
  maxDiscountAmount: number | null | undefined
): boolean {
  if (!discount || discount.type !== "percentage") return false
  return maxDiscountAmount != null && Number.isFinite(maxDiscountAmount)
}

/**
 * 「이 쿠폰이 낼 수 있는 최대 할인액」 — 서로 다른 종류의 쿠폰을 한 줄에 세우는 유일한 기준.
 *
 * 옛 정렬은 정률을 무조건 정액 위로 올리고 raw `value` 로 비교해서, 「10% 최대 3천원」이
 * 「5만원 정액」보다 위에 왔다(#488 A4 표시 목록의 «진짜 버그»). 상한 없는 정률만 무한이다.
 */
export function maxPossibleDiscount(
  discount: CouponDiscountLike | null | undefined,
  maxDiscountAmount: number | null | undefined
): number {
  if (!discount) return 0
  if (discount.type !== "percentage") return discount.value
  if (maxDiscountAmount != null && Number.isFinite(maxDiscountAmount)) {
    return maxDiscountAmount
  }
  return Number.POSITIVE_INFINITY
}
