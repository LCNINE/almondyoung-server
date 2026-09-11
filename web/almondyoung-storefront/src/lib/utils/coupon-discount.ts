/**
 * 쿠폰 할인 표기·정렬의 공통 판정 (#488 A4).
 *
 * 라벨 자체는 화면마다 i18n 네임스페이스가 달라(`mypage.coupon` · `checkout.discount` ·
 * `couponClaim`) 여기서 만들지 않는다. **번역이 필요 없는 판정만** 여기 둔다 — 그래야
 * vitest 가 닿는다(`.tsx` 안의 삼항 연산자는 어떤 러너도 안 본다).
 */

import { formatPrice } from "./price-utils"

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

/**
 * 어드민이 붙인 「쿠폰 이름」 (#789). 쓸 수 있는 이름이 없으면 `null`.
 *
 * 호출부는 `couponName(promo.name) ?? promo.code` 로 제목을 정한다 — **폴백은 화면의 일**이고
 * 서버는 이름이 없으면 `null` 을 그대로 내려보낸다. 서버가 코드로 대신 채우면 화면이
 * 「이름 없음」과 「이름이 코드와 같음」을 구분하지 못해 제목·부제가 같은 문자열로 두 번 찍힌다.
 *
 * 🔴 서버가 이미 trim 하는데도(`resolveCouponName`) 여기서 또 하는 이유: medusa 와
 * storefront 는 한 SST 스택이라 **배포 순서를 정할 수단이 없다.** 옛 medusa 가 도는 동안
 * 이 키는 아예 없고(`undefined`), 그때 화면이 코드로 돌아가는 것이 유일한 안전장치다.
 */
export function couponName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  return trimmed === "" ? null : trimmed
}

/** 마이페이지 쿠폰 카드 좌측 레일이 쓰는 숫자/단위 쌍 (#790). */
export type CouponDiscountParts = {
  /** 크게 보여줄 숫자. 정액만 천단위 구분자가 들어간다. */
  value: string
  /** 아래 줄에 작게 붙는 단위. 라벨 문구는 호출부의 i18n 네임스페이스가 정한다. */
  unit: "percent" | "won"
}

/**
 * 할인 표기를 «숫자» 와 «단위» 로 쪼갠다 (#790).
 *
 * 카드 좌측 레일은 `w-28`(112px) + `px-3` 라 글자가 쓸 수 있는 폭이 **88px** 뿐인데,
 * 「1,000원」이 한 덩어리로 24px 볼드로 들어가 딱 넘쳤다 — 「1,000」/「원」으로 접혔다.
 * 자릿수에 따라 글자를 줄이면 **금액이 클수록 할인이 작게 보이는** 역설이 생기므로,
 * 단위를 아래 줄로 내리고 숫자만 24px 로 남긴다. 레일의 줄 수는 그대로다 —
 * 「할인」이 이미 별도 줄이었고 거기에 단위 글자가 합류할 뿐이다.
 */
export function discountParts(
  discount: CouponDiscountLike | null | undefined
): CouponDiscountParts | null {
  if (!discount) return null
  if (discount.type === "percentage") {
    // 정률에 천단위 구분자를 넣지 않는다 — `1,000%` 는 존재할 수 없는 값이고,
    // 넣으면 레일 폭 계산의 전제가 조용히 바뀐다.
    return { value: String(discount.value), unit: "percent" }
  }
  return { value: formatPrice(discount.value), unit: "won" }
}
