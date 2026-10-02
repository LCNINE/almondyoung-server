/**
 * 「이 기간에 멤버십 혜택을 썼는가」의 판정. 청약철회(환불)와 미납 요금(외상)이 **같은 판정**을 쓴다 —
 * 둘이 갈리면 「돈을 냈으면 환불받았을 사람에게 외상이 달리는」 모순이 생긴다.
 *
 * 약관상 혜택은 «멤버십 회원에게만 제공되는 모든 혜택»이다. 여기에는 서버가 이용 사실을 «기록으로»
 * 아는 것만 들어온다. 새 혜택이 생기면 그 이용 기록을 이 모양에 칸으로 더하고 아래 판정에 한 줄 더한다.
 *
 * 아직 들어오지 않은 것: 멤버십 전용 쿠폰 사용 · 멤버십 전용 상품 구매. 이용 기록이 쇼핑몰 엔진에만
 * 있어 이 서비스로 넘어오지 않는다. 그 전까지 이 둘만 쓴 고객은 «미사용»으로 판정된다(고객에게 유리한 쪽).
 */
export interface MembershipBenefitUsage {
  /** 받은 멤버십 할인 합계(멤버십가·멤버십 타임세일, 취소된 주문 제외) */
  totalDiscountAmount: number;
  /** 할인을 받은 주문 수. 표시용이며 판정에는 쓰지 않는다 — 주문했어도 할인이 0원이면 혜택이 아니다. */
  orderCount: number;
  /** 멤버십 전용 웰컴딜을 샀는가(취소되면 기록이 지워진다). */
  welcomeDeal: boolean;
}

export const NO_BENEFIT_USAGE: MembershipBenefitUsage = { totalDiscountAmount: 0, orderCount: 0, welcomeDeal: false };

export function hasUsedMembershipBenefit(usage: MembershipBenefitUsage): boolean {
  return usage.totalDiscountAmount > 0 || usage.welcomeDeal;
}
