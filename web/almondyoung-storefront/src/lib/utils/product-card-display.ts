export type CardPriceDisplayInput = {
  /** 이 방문자가 실제로 결제하는 값 (Medusa calculated_price). */
  price: number
  /** 정가 (Medusa original_price = price list 없는 기본 가격). */
  originalPrice: number
  /** 정가 − 멤버십가. 멤버십가가 없으면 undefined. */
  membershipSavings?: number
  /** 멤버십 구독자인지. 로그인 여부가 아니다. */
  isMembership?: boolean
}

export type CardPriceDisplay = {
  displayPrice: number
  /** 취소선으로 그릴 값. 깎인 게 없으면 undefined. */
  displayOriginalPrice?: number
  displayDiscount: number
  membershipPrice?: number
  /** 구독자에게 "멤버십 할인가" 라벨을 붙일지. */
  showMembershipBadge: boolean
  /** 미구독자에게 "가입 시 N원 절약" 을 띄울지. */
  showMembershipHint: boolean
  /** 힌트에 쓸 절약액. 지금 표시가 기준이다. */
  membershipHintSavings?: number
}

/**
 * 상품 카드에 그릴 가격.
 *
 * **표시가는 언제나 `calculated_price`(= 실제 결제가)다.** 예전에는 미구독 방문자에게 일부러
 * 정가를 보여주고 "가입 시 N원 절약" 을 붙였는데, 그건 "calculated_price = 멤버십가" 라는 전제
 * 위에서만 성립한다. 타임세일 price list 가 들어오면 미구독자의 calculated_price 도 정가보다
 * 낮아지므로, 그 전제대로 두면 세일가가 화면 어디에도 안 나온다 — 할인율은 70% 인데 가격은 정가로
 * 찍힌다. 세일이 없는 동안에는 미구독자의 calculated_price 가 곧 정가라 출력이 예전과 같다.
 */
export function resolveCardPriceDisplay({
  price,
  originalPrice,
  membershipSavings,
  isMembership,
}: CardPriceDisplayInput): CardPriceDisplay {
  const membershipPrice =
    membershipSavings != null && membershipSavings > 0
      ? originalPrice - membershipSavings
      : undefined

  const displayPrice = price > 0 ? price : originalPrice
  const isDiscounted = originalPrice > 0 && displayPrice < originalPrice

  // 미구독자에게 멤버십가는 지금 보고 있는 값보다 쌀 때만 유인이 된다.
  // 타임세일 중에는 표시가가 이미 멤버십가 밑으로 내려가 힌트가 사라진다 — 그 시점의 멤버십
  // 세일가는 이 응답에 실리지 않으므로, 틀린 절약액을 보여주느니 숨긴다.
  const showMembershipHint =
    !isMembership && membershipPrice != null && membershipPrice < displayPrice

  return {
    displayPrice,
    displayOriginalPrice: isDiscounted ? originalPrice : undefined,
    displayDiscount: isDiscounted
      ? Math.round(((originalPrice - displayPrice) / originalPrice) * 100)
      : 0,
    membershipPrice,
    showMembershipBadge: Boolean(isMembership) && isDiscounted,
    showMembershipHint,
    membershipHintSavings: showMembershipHint
      ? displayPrice - (membershipPrice as number)
      : undefined,
  }
}
