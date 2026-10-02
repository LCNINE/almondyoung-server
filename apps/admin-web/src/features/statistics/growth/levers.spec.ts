import { bestRolling7, bestRolling7Ratio, planLevers } from './levers';

const base = {
  // 필요 120만/일, 현재 100만/일 → 하루 20만 부족. 자사몰 60만/일(방문 2,000 · 주문 30 · 객단가 2만)
  requiredDaily: 1_200_000,
  currentDaily: 1_000_000,
  ownMall: { sessionsPerDay: 2_000, ordersPerDay: 30, netRevenuePerDay: 600_000 },
  returning: { buyers28: 200, revenue28: 5_600_000, bestBuyers28: 260 },
  best: { sessionsPerDay: 2_500, conversion: 0.016, aov: 21_000 },
};

describe('planLevers', () => {
  it('한 축만 움직일 때의 필요치 — 자사몰 매출 배율 (60+20)/60 을 그 축에 곱한다 (손계산)', () => {
    const plan = planLevers(base);
    expect(plan.dailyGap).toBe(200_000);
    const by = Object.fromEntries(plan.levers.map((l) => [l.key, l]));
    expect(by.sessions.required).toBeCloseTo(2_000 * (4 / 3), 9); // 2,666.7 — 과거 최고 2,500 초과
    expect(by.sessions.realism).toBe('beyond');
    expect(by.conversion.current).toBeCloseTo(0.015, 12);
    expect(by.conversion.required).toBeCloseTo(0.02, 12); // 과거 최고 1.6% 초과
    expect(by.conversion.realism).toBe('beyond');
    expect(by.aov.required).toBeCloseTo(26_666.67, 1); // 과거 최고 21,000 초과
    // 재구매: 28일 부족분 560만 ÷ 1인당 2.8만 = 200명 더 → 400명, 과거 최고 260 초과
    expect(by.repeat.delta).toBeCloseTo(200, 9);
    expect(by.repeat.required).toBeCloseTo(400, 9);
    expect(plan.balancedLift).toBeCloseTo(Math.cbrt(4 / 3) - 1, 12);
    expect(plan.easiest).toBeNull();
  });

  it('과거 최고 이내에서 상승률이 가장 작은 레버를 «가장 쉬운 길»로 고른다', () => {
    const plan = planLevers({ ...base, requiredDaily: 1_060_000, best: { sessionsPerDay: 2_500, conversion: 0.017, aov: 21_000 } });
    // 배율 66/60 = 1.1 → 방문 2,200(이내)·전환 1.65%(이내)·객단가 22,000(초과) — 방문·전환 동률이면 앞의 것
    expect(plan.levers.find((l) => l.key === 'aov')?.realism).toBe('beyond');
    expect(plan.easiest).toBe('sessions');
  });

  it('목표 속도를 이미 넘으면 onTrack, 레버 필요치는 현재와 같다', () => {
    const plan = planLevers({ ...base, requiredDaily: 900_000 });
    expect(plan.onTrack).toBe(true);
    expect(plan.levers[0].lift).toBe(0);
    expect(plan.easiest).toBeNull();
  });

  it('GA4 방문이 없으면 방문·전환 레버는 «계산 불가», 균형안도 없다 — 객단가·재구매는 낸다', () => {
    const plan = planLevers({ ...base, ownMall: { ...base.ownMall, sessionsPerDay: null } });
    const by = Object.fromEntries(plan.levers.map((l) => [l.key, l]));
    expect(by.sessions.unavailable).toBe('GA4 방문 데이터가 없습니다');
    expect(by.conversion.required).toBeNull();
    expect(by.aov.required).not.toBeNull();
    expect(plan.balancedLift).toBeNull();
  });
});

describe('rolling bests', () => {
  it('7일 평균 최고치', () => {
    expect(bestRolling7([1, 1, 1, 1, 1, 1, 1, 8])).toBe(2);
    expect(bestRolling7([1, 2, 3])).toBeNull();
  });
  it('비율은 7일 합끼리 나눈다(일별 비율 평균이 아니다)', () => {
    expect(bestRolling7Ratio([0, 0, 0, 0, 0, 0, 7], [1, 1, 1, 1, 1, 1, 994])).toBeCloseTo(0.007, 12);
  });
});
