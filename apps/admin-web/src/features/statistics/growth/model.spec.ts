import type { GrowthAnalysis, GrowthSummary } from '@/lib/api/domains/analytics';
import { addDays, isPartialBucket } from './calendar';
import { changeSignals, goalView, hasExternalChannels, monitorStats, periodView, refundMap, repeatRate90 } from './model';

const TODAY = '2027-03-11';

function summary(overrides: Partial<GrowthSummary> = {}): GrowthSummary {
  const monitorDaily = Array.from({ length: 57 }, (_, i) => {
    const date = addDays(TODAY, -56 + i);
    return { date, allChannels: 9_000, ownMall: 6_000, ownMallOrders: 3 };
  });
  const customers = {
    range: { from: addDays(TODAY, -27), to: TODAY },
    previousRange: { from: addDays(TODAY, -55), to: addDays(TODAY, -28) },
    current: { buyers: 50, newBuyers: 30, returningBuyers: 20, repeatBuyers: 5, newBuyerRevenue: 100_000, returningBuyerRevenue: 80_000 },
    previous: { buyers: 40, newBuyers: 25, returningBuyers: 15, repeatBuyers: 3, newBuyerRevenue: 90_000, returningBuyerRevenue: 60_000 },
    growthAccounting: {
      current: { newCustomers: 30, retained: 10, resurrected: 10, churned: 25, quickRatio: 1.6 },
      previous: { newCustomers: 25, retained: 8, resurrected: 7, churned: 30, quickRatio: 1.07 },
    },
    repeatHeadline: { days: 90, current: { firstBuyers: 40, repeaters: 10, from: '', to: '' }, previous: { firstBuyers: 0, repeaters: 0, from: '', to: '' } },
    repurchaseDue: { customers: 7, fromDays: 19, toDays: 36 },
    timeToSecond: { p25: 19, p50: 28, p75: 36, n: 10 },
  };
  return {
    today: TODAY,
    year: 2027,
    dataAsOf: null,
    coverageStart: '2026-08-01',
    channels: ['medusa'],
    goal: null,
    ytdDaily: monitorDaily.filter((d) => d.date >= '2027-01-01'),
    monitorDaily,
    ga4Daily: { status: 'ok', points: monitorDaily.map((d) => ({ date: d.date, sessions: 200, transactions: 2 })) },
    buyersDaily: monitorDaily.map((d, i) => ({ date: d.date, buyers: i < 28 ? 2 : 3 })),
    customers,
    ...overrides,
  };
}

describe('monitorStats', () => {
  it('최근 완료 28일(오늘 제외) 일평균과 직전 28일, wallet 환불 차감', () => {
    const refunds = refundMap([{ day: addDays(TODAY, -1), amount: 2_800 }]);
    const m = monitorStats(summary(), refunds);
    expect(m.sessionsPerDay).toBe(200);
    expect(m.ordersPerDay).toBe(3);
    expect(m.ownNetPerDay).toBeCloseTo(6_000 - 100, 9);
    expect(m.previous.ownNetPerDay).toBe(6_000);
    expect(m.best.conversion).toBeCloseTo(3 / 200, 12);
    expect(m.spark).toHaveLength(28);
    // 최근 완료 28일 = 인덱스 28~55 → 3명, 직전 28일 = 0~27 → 2명 (오늘(56)은 빼고)
    expect(m.buyersPerDay).toBe(3);
    expect(m.previous.buyersPerDay).toBe(2);
    expect(m.spark[27].date).toBe(addDays(TODAY, -1));
  });

  it('GA4 가 없으면 방문·전환 최고치는 null, 주문·매출은 그대로', () => {
    const m = monitorStats(summary({ ga4Daily: { status: 'disabled', points: [] } }), null);
    expect(m.sessionsPerDay).toBeNull();
    expect(m.best.conversion).toBeNull();
    expect(m.best.aov).toBeCloseTo(2_000, 9);
  });
});

describe('goalView', () => {
  it('목표가 없으면 null — 0 으로 꾸미지 않는다', () => {
    const s = summary();
    expect(goalView(s, null, monitorStats(s, null))).toBeNull();
  });

  it('목표가 있으면 페이싱·확률·레버를 같은 숫자로 엮는다', () => {
    const monthly = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((d) => d * 10_000);
    const s = summary({
      goal: { id: 'g', year: 2027, scope: 'all_channels', annualTarget: 3_650_000, monthlyTargets: monthly, preCoverageActual: null, planAssumptions: null, memo: null, createdAt: '' },
    });
    const v = goalView(s, null, monitorStats(s, null))!;
    expect(v.pacing.currentDaily).toBe(9_000);
    expect(v.pacing.currentDailyExternal).toBe(3_000);
    expect(v.levers.dailyGap).toBeCloseTo(v.pacing.requiredDaily - 9_000, 9);
    expect(v.probability).not.toBeNull();
  });
});

describe('changeSignals', () => {
  it('GA4 가 있으면 방문·전환까지 8개, 없으면 주문·매출 4개', () => {
    expect(changeSignals(summary(), null)).toHaveLength(8);
    expect(changeSignals(summary({ ga4Daily: { status: 'failed', points: [] } }), null)).toHaveLength(4);
  });
  it('평소와 같으면 유의한 신호가 없다', () => {
    expect(changeSignals(summary(), null).filter((s) => s.verdict === 'up' || s.verdict === 'down')).toEqual([]);
  });
});

describe('periodView', () => {
  const analysis = (status: 'ok' | 'disabled'): GrowthAnalysis =>
    ({
      range: { from: '', to: '' },
      granularity: 'day',
      today: TODAY,
      revenue: {
        previousRange: { from: '', to: '' },
        ownMall: {
          series: [],
          current: { orders: 30, grossRevenue: 0, cancelledAmount: 0, refundedAmount: 0, netRevenue: 600_000 },
          previous: { orders: 25, grossRevenue: 0, cancelledAmount: 0, refundedAmount: 0, netRevenue: 500_000 },
        },
        channels: [],
      },
      customers: {} as GrowthAnalysis['customers'],
      ga4: {
        status,
        previousRange: { from: '', to: '' },
        totals: status === 'ok' ? { current: { sessions: 2000, totalUsers: 0, newUsers: 0, transactions: 24 }, previous: { sessions: 2000, totalUsers: 0, newUsers: 0, transactions: 20 } } : null,
        series: [],
        channelSeries: [],
        channels: [],
        devices: [],
        visitorTypes: [],
        funnel: null,
        paymentReturns: null,
      },
    }) as GrowthAnalysis;

  it('매출 방정식: 방문 × (DB 주문 ÷ 방문) × (순매출 ÷ 주문) — 곱이 자사몰 순매출과 같다', () => {
    const v = periodView(analysis('ok'));
    if (!v.equation.ok) throw new Error(v.equation.reason);
    expect(v.equation.currentTotal).toBeCloseTo(600_000, 6);
    expect(v.equation.previousTotal).toBeCloseTo(500_000, 6);
    expect(v.captureRate).toBeCloseTo(24 / 30, 12);
  });

  it('GA4 미연동이면 방정식은 사유와 함께 «분해 불가»', () => {
    const v = periodView(analysis('disabled'));
    expect(v.equation).toEqual({ ok: false, reason: 'GA4 미연동이라 방문을 알 수 없어 나눌 수 없습니다' });
    expect(v.conversion.current).toBeNull();
    expect(v.aov.current).toBe(20_000);
  });
});

describe('repeatRate90', () => {
  it('첫구매 고객이 없으면 null', () => {
    const r = repeatRate90(summary());
    expect(r.current).toBe(0.25);
    expect(r.previous).toBeNull();
  });
});

describe('isPartialBucket', () => {
  it('기간 양 끝의 덜 찬 주·월만 부분 버킷', () => {
    expect(isPartialBucket('2026-08-31', 'week', '2026-09-02', '2026-10-01')).toBe(true);
    expect(isPartialBucket('2026-09-07', 'week', '2026-09-02', '2026-10-01')).toBe(false);
    expect(isPartialBucket('2026-09-28', 'week', '2026-09-02', '2026-10-01')).toBe(true);
    expect(isPartialBucket('2026-09', 'month', '2026-09-01', '2026-09-30')).toBe(false);
    expect(isPartialBucket('2026-10', 'month', '2026-09-01', '2026-10-01')).toBe(true);
    expect(isPartialBucket('2026-09-02', 'day', '2026-09-02', '2026-10-01')).toBe(false);
  });
});

describe('목표 범위', () => {
  const monthly = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((d) => d * 10_000);
  const goal = (scope: 'own_mall' | 'all_channels') => ({
    id: 'g', year: 2027, scope, annualTarget: 3_650_000, monthlyTargets: monthly, preCoverageActual: null, planAssumptions: null, memo: null, createdAt: '',
  });

  it('자사몰 범위면 자사몰 매출만 달성액이 되고 외부 몫은 0', () => {
    const s = summary({ goal: goal('own_mall') });
    const v = goalView(s, null, monitorStats(s, null))!;
    expect(v.pacing.currentDaily).toBe(6_000);
    expect(v.pacing.currentDailyExternal).toBe(0);
  });

  it('외부 채널이 집계에 있는지로 «전 채널» 스위치를 연다', () => {
    expect(hasExternalChannels({ channels: ['medusa'] })).toBe(false);
    expect(hasExternalChannels({ channels: ['medusa', 'naver'] })).toBe(true);
    expect(hasExternalChannels({ channels: [] })).toBe(false);
  });
});
