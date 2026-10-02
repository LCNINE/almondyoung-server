import { addDays } from './calendar';
import { computePacing, planBetween, type DailyNet } from './pacing';

// 2027년(365일), 연 3,650,000원을 일수 비례로 → 하루 10,000원, 월 = 일수 × 10,000.
const MONTHLY = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((d) => d * 10_000);
const GOAL = { annualTarget: 3_650_000, monthlyTargets: MONTHLY, preCoverageActual: null };

function days(from: string, to: string, all: number, own: number): DailyNet[] {
  const out: DailyNet[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, allChannels: all, ownMall: own });
  return out;
}

describe('planBetween', () => {
  it('월 목표를 그 달 일수로 나눈 하루치를 날짜만큼 더한다 — 달을 넘는 구간', () => {
    expect(planBetween(2027, MONTHLY, '2027-01-30', '2027-02-02')).toBeCloseTo(40_000, 6);
    expect(planBetween(2027, MONTHLY, '2027-01-01', '2027-12-31')).toBeCloseTo(3_650_000, 6);
  });
});

describe('computePacing', () => {
  const base = {
    today: '2027-03-11',
    year: 2027,
    goal: GOAL,
    coverageStart: '2026-08-01',
    ytdDaily: days('2027-01-01', '2027-03-11', 9_000, 6_000),
    orderRefundsByDay: new Map([
      ['2027-03-05', 2_000],
      ['2027-03-11', 1_000],
    ]),
  };

  it('어제까지 기준으로 달성·계획·페이스를 내고 wallet 환불을 뺀다 (손계산)', () => {
    const p = computePacing(base);
    expect(p.asOf).toBe('2027-03-10');
    // 1/1~3/10 = 69일 × 9,000 − 환불 2,000
    expect(p.actualToDate).toBe(619_000);
    // 오늘(3/11) 9,000 − 환불 1,000 을 더한 값
    expect(p.actualIncludingToday).toBe(627_000);
    expect(p.planToDate).toBeCloseTo(690_000, 6);
    expect(p.paceRatio).toBeCloseTo(619_000 / 690_000, 9);
    expect(p.paceGap).toBeCloseTo(-71_000, 6);
    expect(p.paceTone).toBe('behind');
    expect(p.remainingDays).toBe(296);
    expect(p.remainingAmount).toBe(3_031_000);
    expect(p.requiredDaily).toBeCloseTo(3_031_000 / 296, 9);
    // 최근 28일(2/11~3/10): 28 × 9,000 − 2,000
    expect(p.runRateDaysUsed).toBe(28);
    expect(p.currentDaily).toBeCloseTo(250_000 / 28, 9);
    expect(p.currentDailyOwnMall).toBeCloseTo((28 * 6_000 - 2_000) / 28, 9);
    expect(p.currentDailyExternal).toBeCloseTo(3_000, 9);
    expect(p.landing).toBeCloseTo(619_000 + (250_000 / 28) * 296, 6);
    expect(p.requiredLift).toBeCloseTo(3_031_000 / 296 / (250_000 / 28) - 1, 9);
    expect(p.refundDeducted).toBe(true);
    expect(p.refundDeductedAmount).toBe(3_000);
    expect(p.missingPreCoverage).toBe(false);
  });

  it('wallet 환불을 못 받으면 빼지 않고 «차감 안 됨»으로 알린다', () => {
    const p = computePacing({ ...base, orderRefundsByDay: null });
    expect(p.actualToDate).toBe(621_000);
    expect(p.refundDeducted).toBe(false);
    expect(p.refundDeductedAmount).toBe(0);
  });

  it('집계가 연중에 시작했고 이전 실적 입력이 없으면 계획을 집계 첫날부터 잰다', () => {
    const p = computePacing({
      ...base,
      coverageStart: '2027-02-01',
      ytdDaily: days('2027-02-01', '2027-03-11', 9_000, 6_000),
      orderRefundsByDay: new Map(),
    });
    expect(p.missingPreCoverage).toBe(true);
    expect(p.planStart).toBe('2027-02-01');
    // 2/1~3/10 = 38일
    expect(p.planToDate).toBeCloseTo(380_000, 6);
    expect(p.actualToDate).toBe(38 * 9_000);
  });

  it('집계 이전 실적을 입력하면 연초부터 잰다', () => {
    const p = computePacing({
      ...base,
      coverageStart: '2027-02-01',
      goal: { ...GOAL, preCoverageActual: 310_000 },
      ytdDaily: days('2027-02-01', '2027-03-11', 9_000, 6_000),
      orderRefundsByDay: new Map(),
    });
    expect(p.missingPreCoverage).toBe(false);
    expect(p.planStart).toBe('2027-01-01');
    expect(p.actualToDate).toBe(310_000 + 38 * 9_000);
    expect(p.planToDate).toBeCloseTo(690_000, 6);
  });

  it('목표를 넘기면 남은 목표 0·초과 표시', () => {
    const p = computePacing({ ...base, goal: { ...GOAL, annualTarget: 500_000, monthlyTargets: MONTHLY.map(() => 0).map((_, i) => (i === 0 ? 500_000 : 0)) } });
    expect(p.exceeded).toBe(true);
    expect(p.remainingAmount).toBe(0);
    expect(p.requiredDaily).toBe(0);
  });
});
