import { attributeFunnel } from './funnel';

describe('attributeFunnel', () => {
  it('단계별 몫의 합이 1 이고, 결제 단계에서만 떨어지면 그 단계가 전부를 차지한다', () => {
    const prev = { view_item: 500, add_to_cart: 100, begin_checkout: 50, add_payment_info: 40, purchase: 20 };
    const cur = { view_item: 500, add_to_cart: 100, begin_checkout: 50, add_payment_info: 40, purchase: 10 };
    const f = attributeFunnel({ current: 1000, previous: 1000 }, { current: cur, previous: prev });
    expect(f.previousOverall).toBeCloseTo(0.02, 12);
    expect(f.currentOverall).toBeCloseTo(0.01, 12);
    const sum = f.steps.reduce((s, x) => s + (x.share ?? 0), 0);
    expect(sum).toBeCloseTo(1, 12);
    expect(f.dominant?.key).toBe('purchase');
    expect(f.dominant?.share).toBeCloseTo(1, 12);
  });

  it('두 단계가 나눠 떨어지면 로그 비율로 몫을 나눈다 (손계산)', () => {
    const prev = { view_item: 500, add_to_cart: 100, begin_checkout: 50, add_payment_info: 40, purchase: 20 };
    // 담기 100→50 (단계율 0.2→0.1), 구매 단계율 0.5→0.25
    const cur = { view_item: 500, add_to_cart: 50, begin_checkout: 25, add_payment_info: 20, purchase: 5 };
    const f = attributeFunnel({ current: 1000, previous: 1000 }, { current: cur, previous: prev });
    const cart = f.steps.find((s) => s.key === 'add_to_cart')!;
    const buy = f.steps.find((s) => s.key === 'purchase')!;
    expect(cart.share).toBeCloseTo(0.5, 12);
    expect(buy.share).toBeCloseTo(0.5, 12);
  });

  it('건수가 0 인 단계가 있으면 나누지 않는다', () => {
    const f = attributeFunnel(
      { current: 10, previous: 10 },
      { current: { view_item: 0 }, previous: { view_item: 1 } },
    );
    expect(f.dominant).toBeNull();
    expect(f.reason).toBeDefined();
  });
});
