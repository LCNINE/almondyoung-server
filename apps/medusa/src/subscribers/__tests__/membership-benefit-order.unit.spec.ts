import { calculateMembershipDiscount, type OrderItem } from '../membership-benefit-order';

// 멤버십 혜택 기록(→ 해지 시 환불 차단)은 이 함수가 > 0 을 낼 때만 트리거된다.
// (subscriber: `if (discountAmount <= 0) return;`)
// 즉 "멤버십 할인가가 실제 적용된 상품(compare_at > 실결제가)"을 샀을 때만 혜택 사용으로 잡힌다.
const item = (o: Partial<OrderItem>): OrderItem => ({
  id: 'li',
  unit_price: 10000,
  compare_at_unit_price: null,
  quantity: 1,
  ...o,
});

describe('calculateMembershipDiscount - 혜택 사용 판정 신호', () => {
  it('정가 구매(compare_at 없음)는 할인 0 → 혜택 미기록', () => {
    expect(calculateMembershipDiscount([item({ compare_at_unit_price: null })])).toBe(0);
  });

  it('compare_at == 실결제가(할인 아님)도 할인 0 → 혜택 미기록', () => {
    expect(
      calculateMembershipDiscount([item({ unit_price: 10000, compare_at_unit_price: 10000 })]),
    ).toBe(0);
  });

  it('compare_at < 실결제가(비정상/인상)도 음수 아닌 0 처리 → 혜택 미기록', () => {
    expect(
      calculateMembershipDiscount([item({ unit_price: 10000, compare_at_unit_price: 8000 })]),
    ).toBe(0);
  });

  it('멤버십 할인가 적용(compare_at > 실결제가) → 할인액 = (compare_at - 실결제가) * 수량', () => {
    expect(
      calculateMembershipDiscount([item({ unit_price: 8000, compare_at_unit_price: 10000, quantity: 3 })]),
    ).toBe(6000);
  });

  it('할인 상품 + 정가 상품 혼합 → 할인 상품분만 합산', () => {
    const discount = calculateMembershipDiscount([
      item({ id: 'a', unit_price: 9000, compare_at_unit_price: 12000, quantity: 2 }), // 6000
      item({ id: 'b', unit_price: 5000, compare_at_unit_price: null, quantity: 5 }), // 0 (정가)
    ]);
    expect(discount).toBe(6000);
  });

  it('빈 주문은 0', () => {
    expect(calculateMembershipDiscount([])).toBe(0);
  });
});
