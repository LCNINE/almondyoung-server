import { daysInMonthOf, eachDay, prorateOperatingCost, resolveMonthlyCost } from './operating-cost.service';

const rows = [
  { id: 'a', monthlyFixedCost: 3_000_000, effectiveFrom: '2026-01-01', memo: null },
  { id: 'b', monthlyFixedCost: 6_200_000, effectiveFrom: '2026-08-01', memo: null },
];

describe('daysInMonthOf', () => {
  it('달마다 실제 일수를 준다', () => {
    expect(daysInMonthOf('2026-02-15')).toBe(28);
    expect(daysInMonthOf('2026-04-30')).toBe(30);
    expect(daysInMonthOf('2026-08-01')).toBe(31);
  });

  it('윤년 2월은 29일', () => {
    expect(daysInMonthOf('2028-02-01')).toBe(29);
  });
});

describe('eachDay', () => {
  it('월을 넘겨도 날짜가 밀리지 않는다', () => {
    expect(eachDay('2026-08-30', '2026-09-01')).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
  });

  it('하루 기간은 한 칸', () => {
    expect(eachDay('2026-08-10', '2026-08-10')).toEqual(['2026-08-10']);
  });
});

describe('resolveMonthlyCost', () => {
  it('그 날 이하 중 가장 늦은 적용일의 값을 고른다', () => {
    expect(resolveMonthlyCost(rows, '2026-07-31')).toBe(3_000_000);
    expect(resolveMonthlyCost(rows, '2026-08-01')).toBe(6_200_000);
    expect(resolveMonthlyCost(rows, '2026-12-31')).toBe(6_200_000);
  });

  it('설정 시작 전이거나 설정이 없으면 null', () => {
    expect(resolveMonthlyCost(rows, '2025-12-31')).toBeNull();
    expect(resolveMonthlyCost([], '2026-08-10')).toBeNull();
  });
});

describe('prorateOperatingCost', () => {
  it('한 달을 통째로 조회하면 월 고정비 그대로가 나온다', () => {
    const result = prorateOperatingCost(rows, '2026-08-01', '2026-08-31');
    expect(result.amount).toBe(6_200_000);
    expect(result.coveredDays).toBe(31);
    expect(result.uncoveredDays).toBe(0);
  });

  it('일수가 다른 달의 하루치는 서로 다르다 — 월 고정비를 그 달 일수로 나눈다', () => {
    const february = prorateOperatingCost(rows, '2026-02-01', '2026-02-01');
    const august = prorateOperatingCost(rows, '2026-08-01', '2026-08-01');
    expect(february.amount).toBe(Math.round(3_000_000 / 28));
    expect(august.amount).toBe(Math.round(6_200_000 / 31));
  });

  it('설정이 바뀌는 날을 걸치면 날짜별로 다른 값을 쓴다', () => {
    const result = prorateOperatingCost(rows, '2026-07-31', '2026-08-01');
    expect(result.amount).toBe(Math.round(3_000_000 / 31 + 6_200_000 / 31));
    expect(result.coveredDays).toBe(2);
  });

  it('설정 시작 전 날짜는 0 으로 뭉개지 않고 미커버 일수로 센다', () => {
    const result = prorateOperatingCost(rows, '2025-12-30', '2026-01-02');
    expect(result.coveredDays).toBe(2);
    expect(result.uncoveredDays).toBe(2);
    expect(result.amount).toBe(Math.round((3_000_000 / 31) * 2));
  });

  it('기간 전체가 미설정이면 금액은 null — 0 으로 두면 적자가 흑자로 보인다', () => {
    const result = prorateOperatingCost([], '2026-08-01', '2026-08-31');
    expect(result.amount).toBeNull();
    expect(result.coveredDays).toBe(0);
    expect(result.uncoveredDays).toBe(31);
  });
});
