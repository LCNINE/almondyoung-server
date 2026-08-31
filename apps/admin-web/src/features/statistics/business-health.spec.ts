import { buildBusinessHealth, BusinessHealthInput } from './business-health';

/** 흑자인 기준선 — 여기서 한 가지만 바꿔 각 축이 그 조건에서만 반응하는지 본다. */
const healthy: BusinessHealthInput = {
  estimatedMargin: 12_000_000,
  computedNetRevenue: 40_000_000,
  marginRate: 0.3,
  netRevenue: 50_000_000,
  previousNetRevenue: 45_000_000,
  estimatedFee: 1_000_000,
  feeUncoveredAmount: 0,
  fixedCost: 6_000_000,
  fixedCostUncoveredDays: 0,
  membershipRevenue: 7_000_000,
  stockValue: 30_000_000,
  stockUncostedQuantity: 0,
  rangeDays: 30,
};

function axis(input: BusinessHealthInput, key: string) {
  return buildBusinessHealth(input).axes.find((row) => row.key === key);
}

describe('buildBusinessHealth — 종합 판정', () => {
  it('고정비를 빼고도 남으면 월 환산 이익으로 답한다', () => {
    const { verdict } = buildBusinessHealth(healthy);
    expect(verdict.tone).toBe('good');
    expect(verdict.headline).toBe('이 추세면 월 500만원 남습니다');
  });

  it('적자면 얼마 모자라는지와 얼마를 더 팔았어야 하는지 말한다', () => {
    const { verdict } = buildBusinessHealth({ ...healthy, fixedCost: 15_000_000 });
    expect(verdict.tone).toBe('bad');
    expect(verdict.headline).toBe('이 추세면 월 400만원 모자랍니다');
    // 부족액 400만 ÷ 마진율 0.275 = 약 1,454만
    expect(verdict.detail).toContain('더 팔았어야');
  });

  it('마진율이 0 이하면 더 파는 것으로 해결되지 않는다고 말한다', () => {
    const { verdict } = buildBusinessHealth({ ...healthy, estimatedMargin: -1_000_000 });
    expect(verdict.tone).toBe('bad');
    expect(verdict.detail).toContain('더 파는 것으로는 본전이 되지 않습니다');
  });

  it('고정비가 없으면 흑자·적자 판정을 하지 않는다 — 0 으로 두면 적자가 흑자로 보인다', () => {
    const { verdict } = buildBusinessHealth({ ...healthy, fixedCost: null });
    expect(verdict.tone).toBe('unknown');
    expect(verdict.headline).toBe('흑자인지 적자인지 아직 알 수 없습니다');
    expect(verdict.detail).toContain('월 고정비를 입력하면');
  });

  it('원가도 고정비도 없으면 둘 다 입력하라고 안내한다', () => {
    const { verdict } = buildBusinessHealth({ ...healthy, estimatedMargin: null, fixedCost: null });
    expect(verdict.detail).toContain('상품 원가와 월 고정비');
  });
});

describe('buildBusinessHealth — 성장 축', () => {
  it('늘면 좋음', () => {
    expect(axis(healthy, 'growth')?.tone).toBe('good');
    expect(axis(healthy, 'growth')?.value).toBe('+11%');
  });

  it('10% 넘게 줄면 주의, 25% 넘게 줄면 나쁨', () => {
    expect(axis({ ...healthy, netRevenue: 39_000_000 }, 'growth')?.tone).toBe('watch');
    expect(axis({ ...healthy, netRevenue: 30_000_000 }, 'growth')?.tone).toBe('bad');
  });

  it('직전 기간 매출이 0이면 비교 불가로 둔다 — 0 으로 나누지 않는다', () => {
    const growth = axis({ ...healthy, previousNetRevenue: 0 }, 'growth');
    expect(growth?.tone).toBe('unknown');
    expect(growth?.value).toBe('비교 불가');
  });
});

describe('buildBusinessHealth — 수익성 축', () => {
  it('수수료를 뺀 마진율로 판정한다', () => {
    // (1200만 - 100만) / 4000만 = 27.5%
    expect(axis(healthy, 'margin')?.value).toBe('+28%');
    expect(axis(healthy, 'margin')?.tone).toBe('good');
  });

  it('15% 미만이면 주의, 0 이하면 나쁨', () => {
    expect(axis({ ...healthy, estimatedMargin: 5_000_000 }, 'margin')?.tone).toBe('watch');
    expect(axis({ ...healthy, estimatedMargin: 1_000_000 }, 'margin')?.tone).toBe('bad');
  });

  it('요율 미설정 구간이 있으면 마진이 실제보다 높게 나온다고 밝힌다', () => {
    expect(axis({ ...healthy, feeUncoveredAmount: 5_000_000 }, 'margin')?.detail).toContain('실제보다 높게');
  });

  it('원가가 전혀 없으면 계산 불가', () => {
    expect(axis({ ...healthy, estimatedMargin: null }, 'margin')?.tone).toBe('unknown');
  });
});

describe('buildBusinessHealth — 반복 수입 축', () => {
  it('구독료가 고정비를 얼마나 덮는지 말한다', () => {
    expect(axis(healthy, 'recurring')?.detail).toContain('고정비의 117%');
  });

  it('고정비의 30% 미만이면 나쁨', () => {
    expect(axis({ ...healthy, membershipRevenue: 1_000_000 }, 'recurring')?.tone).toBe('bad');
  });

  it('고정비가 없으면 덮는 비율 대신 금액의 뜻을 설명한다', () => {
    const recurring = axis({ ...healthy, fixedCost: null }, 'recurring');
    expect(recurring?.tone).toBe('good');
    expect(recurring?.detail).toContain('매출이 0인 달에도');
  });
});

describe('buildBusinessHealth — 재고 축', () => {
  it('순매출의 2배를 넘게 묶여 있으면 주의', () => {
    expect(axis({ ...healthy, stockValue: 120_000_000 }, 'stock')?.tone).toBe('watch');
    expect(axis(healthy, 'stock')?.tone).toBe('good');
  });

  it('원가를 못 매긴 재고가 있으면 실제로는 더 크다고 밝힌다', () => {
    expect(axis({ ...healthy, stockUncostedQuantity: 311_948 }, 'stock')?.detail).toContain('실제로는 더 큽니다');
  });

  it('재고 금액을 못 불러오면 계산 불가', () => {
    expect(axis({ ...healthy, stockValue: null }, 'stock')?.tone).toBe('unknown');
  });
});

describe('buildBusinessHealth — 축 구성', () => {
  it('데이터가 하나도 없어도 다섯 축을 모두 내고 전부 판정 불가로 둔다', () => {
    const empty: BusinessHealthInput = {
      estimatedMargin: null,
      computedNetRevenue: null,
      marginRate: null,
      netRevenue: null,
      previousNetRevenue: null,
      estimatedFee: null,
      feeUncoveredAmount: null,
      fixedCost: null,
      fixedCostUncoveredDays: 0,
      membershipRevenue: null,
      stockValue: null,
      stockUncostedQuantity: null,
      rangeDays: 30,
    };
    const health = buildBusinessHealth(empty);
    expect(health.axes.map((row) => row.key)).toEqual(['growth', 'margin', 'operating', 'recurring', 'stock']);
    expect(health.axes.every((row) => row.tone === 'unknown')).toBe(true);
  });
});
