import { lmdi, logMean, mixVsRate } from './decompose';

describe('lmdi', () => {
  it('축별 기여의 합이 총변화와 정확히 같다 (잔차 0)', () => {
    // 세션 1,000→1,200, 전환 2%→1.5%, 객단가 30,000→32,000 → 매출 600,000 → 576,000
    const d = lmdi([
      { key: 'sessions', label: '방문', previous: 1000, current: 1200 },
      { key: 'cvr', label: '전환율', previous: 0.02, current: 0.015 },
      { key: 'aov', label: '객단가', previous: 30000, current: 32000 },
    ]);
    if (!d.ok) throw new Error(d.reason);
    expect(d.previousTotal).toBeCloseTo(600_000, 6);
    expect(d.currentTotal).toBeCloseTo(576_000, 6);
    const sum = d.contributions.reduce((s, c) => s + c.amount, 0);
    expect(sum).toBeCloseTo(-24_000, 6);
    const L = logMean(576_000, 600_000);
    expect(d.contributions[0].amount).toBeCloseTo(L * Math.log(1.2), 6);
    expect(d.contributions[1].amount).toBeCloseTo(L * Math.log(0.75), 6);
    expect(d.contributions[2].amount).toBeCloseTo(L * Math.log(32000 / 30000), 6);
    // 방문은 늘었고(+) 전환이 크게 깎았다(−)
    expect(d.contributions[0].amount).toBeGreaterThan(0);
    expect(d.contributions[1].amount).toBeLessThan(-100_000);
  });

  it('값이 0 인 축이 있으면 분해하지 않고 사유를 낸다', () => {
    const d = lmdi([
      { key: 'sessions', label: '방문', previous: 0, current: 10 },
      { key: 'cvr', label: '전환율', previous: 0.1, current: 0.1 },
    ]);
    expect(d).toEqual({ ok: false, reason: '방문 값이 0 이라 축별로 나눌 수 없습니다' });
  });

  it('변화가 없으면 기여 0, 비중 null', () => {
    const d = lmdi([{ key: 'a', label: 'A', previous: 5, current: 5 }]);
    if (!d.ok) throw new Error(d.reason);
    expect(d.contributions[0]).toMatchObject({ amount: 0, share: null });
  });
});

describe('mixVsRate', () => {
  it('채널별 전환율은 그대로인데 저전환 채널 비중이 늘면 «믹스 효과»다', () => {
    const m = mixVsRate([
      { label: '자연검색', previous: { sessions: 800, conversions: 24 }, current: { sessions: 800, conversions: 24 } }, // 3%
      { label: '소셜', previous: { sessions: 200, conversions: 2 }, current: { sessions: 1200, conversions: 12 } }, // 1%
    ])!;
    // 전체 2.6% → 1.8%
    expect(m.previousRate).toBeCloseTo(0.026, 9);
    expect(m.currentRate).toBeCloseTo(0.018, 9);
    expect(m.mixEffect + m.rateEffect).toBeCloseTo(m.change, 12);
    expect(m.rateEffect).toBeCloseTo(0, 12);
    expect(m.mixDriven).toBe(true);
  });

  it('세그먼트 안 전환이 떨어지면 믹스 효과가 아니다', () => {
    const m = mixVsRate([
      { label: '자연검색', previous: { sessions: 800, conversions: 24 }, current: { sessions: 800, conversions: 8 } },
      { label: '소셜', previous: { sessions: 200, conversions: 2 }, current: { sessions: 200, conversions: 2 } },
    ])!;
    expect(m.rateEffect).toBeLessThan(0);
    expect(m.mixDriven).toBe(false);
    expect(m.mixEffect + m.rateEffect).toBeCloseTo(m.change, 12);
  });

  it('세션이 없으면 null', () => {
    expect(mixVsRate([{ label: 'x', previous: { sessions: 0, conversions: 0 }, current: { sessions: 5, conversions: 1 } }])).toBeNull();
  });
});
