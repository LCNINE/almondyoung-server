import { buildSalesInsights, completedDays, trendStreak } from './sales-insight';
import { SalesDailyPoint } from './sales-table';

function day(date: string, order: number, paid = order, refund = 0): SalesDailyPoint {
  return {
    date,
    orderAmount: order,
    orderCount: order > 0 ? 1 : 0,
    paidAmount: paid,
    paidCount: paid > 0 ? 1 : 0,
    refundAmount: refund,
    refundCount: refund > 0 ? 1 : 0,
  };
}

/** 평탄한 기준선 — 여기에 한 가지만 바꿔 각 문장이 그 조건에서만 나오는지 본다. */
function steady(amount = 100_000): SalesDailyPoint[] {
  return Array.from({ length: 8 }, (_, index) => day(`2026-08-2${index}`, amount));
}

describe('completedDays', () => {
  it('오늘은 비교에서 뺀다 — 아직 안 끝난 하루라 항상 낮게 나온다', () => {
    const points = [day('2026-08-27', 1), day('2026-08-28', 1)];
    expect(completedDays(points, '2026-08-28').map((point) => point.date)).toEqual(['2026-08-27']);
  });
});

describe('trendStreak', () => {
  it('3일 이상 이어져야 방향을 말한다', () => {
    expect(trendStreak([1, 2, 3, 4])).toEqual({ direction: 'up', days: 3 });
    expect(trendStreak([4, 3, 2, 1])).toEqual({ direction: 'down', days: 3 });
  });

  it('2일 연속은 우연이 흔해 말하지 않는다', () => {
    expect(trendStreak([5, 1, 2, 3])).toEqual({ direction: 'flat', days: 0 });
  });

  it('마지막 날이 제자리면 끊긴 것으로 본다', () => {
    expect(trendStreak([1, 2, 3, 3])).toEqual({ direction: 'flat', days: 0 });
  });

  it('관측이 3일 미만이면 판단하지 않는다', () => {
    expect(trendStreak([1, 2])).toEqual({ direction: 'flat', days: 0 });
  });
});

describe('buildSalesInsights', () => {
  it('끝난 날이 4일 미만이면 문장을 만들지 않는다 — 억지 문장은 신뢰를 깎는다', () => {
    const points = [day('2026-08-25', 1), day('2026-08-26', 2), day('2026-08-27', 3)];
    expect(buildSalesInsights(points, '2026-08-27')).toEqual([]);
  });

  it('평소 범위면 그렇다고 한 줄로 답한다', () => {
    const insights = buildSalesInsights(steady(), '2026-08-28');
    expect(insights.map((insight) => insight.key)).toEqual(['steady']);
    expect(insights[0].tone).toBe('neutral');
  });

  it('직전 평균보다 크게 오르면 좋은 신호로 말한다', () => {
    const points = [...steady().slice(0, 7), day('2026-08-27', 200_000)];
    const insight = buildSalesInsights(points, '2026-08-28').find((row) => row.key === 'vs-average');
    expect(insight?.tone).toBe('good');
    expect(insight?.text).toContain('+100%');
  });

  it('직전 평균보다 크게 떨어지면 나쁜 신호로 말한다', () => {
    const points = [...steady().slice(0, 7), day('2026-08-27', 20_000)];
    const insight = buildSalesInsights(points, '2026-08-28').find((row) => row.key === 'vs-average');
    expect(insight?.tone).toBe('bad');
    expect(insight?.text).toContain('-80%');
  });

  it('평균 대비 20% 미만의 흔들림은 말하지 않는다', () => {
    const points = [...steady().slice(0, 7), day('2026-08-27', 110_000)];
    expect(buildSalesInsights(points, '2026-08-28').some((row) => row.key === 'vs-average')).toBe(false);
  });

  it('연속 하락은 일수까지 말한다', () => {
    const points = [
      day('2026-08-20', 100_000),
      day('2026-08-21', 100_000),
      day('2026-08-22', 100_000),
      day('2026-08-23', 100_000),
      day('2026-08-24', 90_000),
      day('2026-08-25', 80_000),
      day('2026-08-26', 70_000),
      day('2026-08-27', 60_000),
    ];
    const insight = buildSalesInsights(points, '2026-08-28').find((row) => row.key === 'streak');
    expect(insight?.text).toBe('주문이 4일 연속 줄고 있습니다');
    expect(insight?.tone).toBe('bad');
  });

  it('결제가 주문에 크게 못 미치면 미입금·이탈을 확인하라고 말한다', () => {
    const points = Array.from({ length: 8 }, (_, index) => day(`2026-08-2${index}`, 100_000, 30_000));
    const insight = buildSalesInsights(points, '2026-08-28').find((row) => row.key === 'payment-gap');
    expect(insight?.text).toContain('30%');
    expect(insight?.tone).toBe('bad');
  });

  it('결제가 주문을 충분히 따라오면 결제 문장을 만들지 않는다', () => {
    const points = Array.from({ length: 8 }, (_, index) => day(`2026-08-2${index}`, 100_000, 95_000));
    expect(buildSalesInsights(points, '2026-08-28').some((row) => row.key === 'payment-gap')).toBe(false);
  });

  it('환불 비중이 높으면 따로 말한다', () => {
    const points = Array.from({ length: 8 }, (_, index) => day(`2026-08-2${index}`, 100_000, 100_000, 30_000));
    const insight = buildSalesInsights(points, '2026-08-28').find((row) => row.key === 'refund');
    expect(insight?.text).toContain('30%');
  });

  it('매출이 0인 기간에는 0으로 나누지 않고 조용히 넘어간다', () => {
    const points = Array.from({ length: 8 }, (_, index) => day(`2026-08-2${index}`, 0, 0));
    expect(buildSalesInsights(points, '2026-08-28').map((row) => row.key)).toEqual(['steady']);
  });
});
