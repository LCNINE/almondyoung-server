import { formatMonthDay, formatWon } from './format';
import { paceCopy } from './pace-copy';
import type { Pacing } from './pacing';

// 합성 숫자: 연 12억, 매달 1억. 9월 30일까지 계획 9억, 실제 8.4억.
const base: Pacing = {
  asOf: '2031-09-30',
  annualTarget: 1_200_000_000,
  actualToDate: 840_000_000,
  actualIncludingToday: 840_000_000,
  planToDate: 900_000_000,
  annualAchievement: 0.7,
  paceRatio: 840_000_000 / 900_000_000,
  paceGap: -60_000_000,
  paceTone: 'behind',
  remainingAmount: 360_000_000,
  exceeded: false,
  remainingDays: 92,
  requiredDaily: 360_000_000 / 92,
  currentDaily: 1_500_000,
  currentDailyOwnMall: 1_500_000,
  currentDailyExternal: 0,
  runRateDaysUsed: 28,
  requiredLift: 360_000_000 / 92 / 1_500_000 - 1,
  landing: 840_000_000 + 1_500_000 * 92,
  landingRatio: (840_000_000 + 1_500_000 * 92) / 1_200_000_000,
  planStart: '2031-01-01',
  missingPreCoverage: false,
  refundDeducted: true,
  refundDeductedAmount: 0,
};
const EQUAL = Array(12).fill(100_000_000);

describe('formatWon', () => {
  it('억은 끝의 0 을 빼고, 만 단위 아래는 원 그대로', () => {
    expect(formatWon(1_250_000_000)).toBe('12.5억 원');
    expect(formatWon(800_000_000)).toBe('8억 원');
    expect(formatWon(160_000_000)).toBe('1.6억 원');
    expect(formatWon(123_456_789)).toBe('1.23억 원');
    expect(formatWon(3_913_043)).toBe('391만 원');
    expect(formatWon(-160_000_000)).toBe('-1.6억 원');
    expect(formatWon(950)).toBe('950원');
  });
  it('날짜는 «9월 30일»', () => {
    expect(formatMonthDay('2031-09-30')).toBe('9월 30일');
    expect(formatMonthDay('2031-01-05')).toBe('1월 5일');
  });
});

describe('paceCopy', () => {
  it('뒤처지면 — 언제까지 얼마였어야 했고 실제 얼마인지, 남은 날 하루 얼마인지', () => {
    const c = paceCopy(base, EQUAL);
    expect(c.tone).toBe('behind');
    expect(c.headline).toBe('목표 일정보다 6,000만 원 늦어요');
    expect(c.detail).toBe('연 12억 원을 매달 1억 원씩 채우려면 9월 30일까지 9억 원을 팔았어야 하는데, 실제로는 8.4억 원(계획의 93%)을 팔았습니다.');
    expect(c.action).toBe('남은 92일 동안 하루 391만 원씩 팔아야 연말에 목표를 채웁니다. 최근 28일 하루 평균은 150만 원입니다.');
  });

  it('앞서 있고 지금 속도로 충분하면 그렇게 말한다', () => {
    const c = paceCopy({ ...base, actualToDate: 960_000_000, paceGap: 60_000_000, paceRatio: 960 / 900, requiredDaily: 240_000_000 / 92, currentDaily: 3_000_000 }, EQUAL);
    expect(c.headline).toBe('목표 일정보다 6,000만 원 앞서 있어요');
    expect(c.action).toContain('씩만 팔아도');
    expect(c.action).toContain('지금 속도면 충분합니다');
  });

  it('월 목표가 고르지 않으면 «월별 목표대로»', () => {
    const months = [...EQUAL];
    months[11] = 200_000_000;
    months[0] = 0;
    expect(paceCopy(base, months).detail).toContain('월별 목표대로 채우려면');
  });

  it('집계 시작 전 실적이 없으면 집계 첫날부터의 계획 몫으로 말한다', () => {
    const c = paceCopy({ ...base, missingPreCoverage: true, planStart: '2031-06-01', planToDate: 500_000_000, actualToDate: 190_000_000, paceRatio: 0.38 }, EQUAL);
    expect(c.detail).toBe('집계 첫날 6월 1일부터 9월 30일까지 계획대로라면 5억 원을 팔았어야 하는데, 실제로는 1.9억 원(계획의 38%)을 팔았습니다.');
  });

  it('목표를 넘었으면 남은 날 안내는 없다', () => {
    const c = paceCopy({ ...base, exceeded: true, actualToDate: 1_300_000_000 }, EQUAL);
    expect(c.tone).toBe('done');
    expect(c.headline).toBe('올해 목표 12억 원을 이미 넘었어요');
    expect(c.action).toBeNull();
  });
});
