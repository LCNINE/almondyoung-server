import { buildBriefing, FORBIDDEN_PHRASES, type BriefingInput } from './briefing';
import type { Pacing } from './pacing';
import { allocateByDays, annualFromAssumptions, daysInYear, plannedAnnual, requiredOwnMallMultiplier } from './planner';
import { buildTrust } from './trust';

const pacing: Pacing = {
  asOf: '2027-03-10',
  annualTarget: 3_650_000,
  actualToDate: 619_000,
  actualIncludingToday: 627_000,
  planToDate: 690_000,
  annualAchievement: 619_000 / 3_650_000,
  paceRatio: 619_000 / 690_000,
  paceGap: -71_000,
  paceTone: 'behind',
  remainingAmount: 3_031_000,
  exceeded: false,
  remainingDays: 296,
  requiredDaily: 10_240,
  currentDaily: 8_929,
  currentDailyOwnMall: 5_929,
  currentDailyExternal: 3_000,
  runRateDaysUsed: 28,
  requiredLift: 10_240 / 8_929 - 1,
  landing: 3_262_000,
  landingRatio: 3_262_000 / 3_650_000,
  planStart: '2027-01-01',
  missingPreCoverage: false,
  refundDeducted: true,
  refundDeductedAmount: 3_000,
};

const full: BriefingInput = {
  hasGoal: true,
  pacing,
  levers: {
    dailyGap: 1_311,
    onTrack: false,
    balancedLift: 0.07,
    easiest: 'conversion',
    levers: [
      { key: 'conversion', label: '주문 전환율', current: 0.015, required: 0.0183, delta: 0.0033, lift: 0.22, best: 0.02, realism: 'within' },
    ],
  },
  signals: [
    { metric: 'conversion', label: '주문 전환율', window: 'day', date: '2027-03-10', actual: 0.012, baseline: 0.019, relativeChange: -0.37, z: -4, verdict: 'down', samples: 8 },
    { metric: 'orders', label: '주문', window: 'day', date: '2027-03-10', actual: 30, baseline: 31, relativeChange: -0.03, z: -0.2, verdict: 'normal', samples: 8 },
  ],
  mix: { previousRate: 0.026, currentRate: 0.018, change: -0.008, mixEffect: -0.008, rateEffect: 0, mixDriven: true, segments: [] },
  funnel: {
    steps: [],
    currentOverall: 0.01,
    previousOverall: 0.02,
    dominant: { key: 'purchase', label: '구매', fromLabel: '결제 정보 입력', current: 0.25, previous: 0.5, share: 0.72 },
  },
  quickRatio: 0.8,
  repurchaseDue: { customers: 312, fromDays: 19, toDays: 36 },
};

describe('buildBriefing', () => {
  it('산술 확정 권고는 «하라», 변화는 «볼 곳», 원인 단정 문구는 하나도 없다', () => {
    const cards = buildBriefing(full);
    expect(cards.map((c) => c.id)).toEqual([
      'goal-pace',
      'lever-easiest',
      'signal-conversion-day',
      'mix',
      'funnel',
      'quick-ratio',
      'repurchase-due',
    ]);
    expect(cards.find((c) => c.id === 'goal-pace')?.kind).toBe('action');
    expect(cards.find((c) => c.id === 'funnel')?.kind).toBe('look');
    for (const c of cards) {
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(`${c.title} ${c.evidence}`).not.toMatch(phrase);
      }
    }
  });

  it('유의하지 않은 흔들림은 카드가 되지 않는다', () => {
    const cards = buildBriefing({ ...full, signals: [full.signals[1]] });
    expect(cards.some((c) => c.id.startsWith('signal-'))).toBe(false);
  });

  it('목표가 없으면 목표 입력 카드가 맨 앞', () => {
    const cards = buildBriefing({ ...full, hasGoal: false, pacing: null });
    expect(cards[0]).toMatchObject({ id: 'goal-missing', href: '/statistics/settings' });
  });

  it('믹스로 설명되는 하락이면 퍼널 카드는 «이 단계를 먼저» 대신 채널 구성을 가리킨다 — 두 카드가 반대를 말하지 않는다', () => {
    const withMix = buildBriefing(full).find((c) => c.id === 'funnel')!;
    expect(withMix.evidence).toContain('채널 구성을 먼저 보세요');
    expect(withMix.evidence).not.toContain('이 단계를 먼저 보세요');
    const noMix = buildBriefing({ ...full, mix: { ...full.mix!, mixDriven: false } }).find((c) => c.id === 'funnel')!;
    expect(noMix.evidence).toContain('이 단계를 먼저 보세요');
  });

  it('퍼널 몫 문구 — «72%가 결제 정보 입력 → 구매 단계에서»', () => {
    const card = buildBriefing(full).find((c) => c.id === 'funnel')!;
    expect(card.title).toBe('방문 대비 구매가 줄어든 몫의 72%가 «결제 정보 입력 → 구매» 단계에서 났습니다');
  });
});

describe('planner', () => {
  it('연매출 = 일수 × (방문 × 전환 × 객단가 + 외부)', () => {
    expect(daysInYear(2028)).toBe(366);
    expect(annualFromAssumptions(2027, { dailySessions: 2000, orderConversionRate: 0.015, averageOrderValue: 20000, externalDailyRevenue: 400000 })).toBe(365 * 1_000_000);
  });
  it('하향식 목표를 맞추려면 자사몰이 몇 배가 돼야 하나', () => {
    const m = requiredOwnMallMultiplier(2027, 365 * 1_200_000, { dailySessions: 2000, orderConversionRate: 0.015, averageOrderValue: 20000, externalDailyRevenue: 400000 });
    expect(m).toBeCloseTo(800_000 / 600_000, 12);
  });
});

describe('buildTrust', () => {
  it('GA4 수집률·결제 후 새 방문·모수·환불을 기준에 따라 표시한다', () => {
    const items = buildTrust({
      ga4Status: 'ok',
      ga4Transactions: 80,
      ownMallOrders: 100,
      paymentReturns: { sessions: 300, transactions: 4 },
      memberOrders: 60,
      refundDeducted: true,
      missingPreCoverage: true,
    });
    expect(items.map((i) => [i.key, i.tone, i.value])).toEqual([
      ['ga4-capture', 'watch', '80.0%'],
      ['payment-returns', 'bad', '5.0%'],
      ['member-coverage', 'info', '60.0%'],
      ['refund', 'good', '반영'],
      ['pre-coverage', 'watch', '미입력'],
    ]);
  });
  it('GA4 미연동이면 수집률 대신 미연동 표시, 결제 세션 항목은 없다', () => {
    const items = buildTrust({ ga4Status: 'disabled', ga4Transactions: null, ownMallOrders: 10, paymentReturns: null, memberOrders: 5, refundDeducted: null, missingPreCoverage: false });
    expect(items[0]).toMatchObject({ key: 'ga4-capture', tone: 'unknown', value: '미연동' });
    expect(items.some((i) => i.key === 'payment-returns')).toBe(false);
  });
});

describe('allocateByDays (서버와 같은 공식)', () => {
  it('합이 정확히 목표와 같고, 2월은 일수만큼 작다', () => {
    const months = allocateByDays(2027, 1_000_000_007);
    expect(months.reduce((a, b) => a + b, 0)).toBe(1_000_000_007);
    expect(months[1]).toBe(Math.floor((1_000_000_007 * 28) / 365));
    expect(months[0]).toBe(Math.floor((1_000_000_007 * 31) / 365));
  });
});

describe('plannedAnnual', () => {
  it('올해는 어제까지 실적 + 남은 날(오늘 포함) × 하루', () => {
    // 10/1 기준 남은 날 = 92일
    expect(plannedAnnual({ year: 2026, today: '2026-10-01', dailyTotal: 1_000_000, actualToYesterday: 200_000_000 })).toBe(292_000_000);
  });
  it('내년은 그 해 일수 × 하루', () => {
    expect(plannedAnnual({ year: 2027, today: '2026-10-01', dailyTotal: 1_000_000, actualToYesterday: 200_000_000 })).toBe(365_000_000);
  });
});
