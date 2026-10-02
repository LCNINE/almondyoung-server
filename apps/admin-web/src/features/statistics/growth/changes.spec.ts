import { addDays } from './calendar';
import { detectRateChange, detectValueChange, detectWeeklyValueChange, median, weeklyTotals } from './changes';

const T = '2027-03-10'; // 수요일
const series = (fn: (i: number, date: string) => number, days = 57) =>
  Array.from({ length: days }, (_, i) => {
    const date = addDays(T, -(days - 1) + i);
    return { date, value: fn(i, date) };
  });

describe('median', () => {
  it('짝수 개는 가운데 두 값의 평균', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('detectValueChange', () => {
  it('같은 요일 기준선 대비 크게 떨어지면 down (robust z, 손계산)', () => {
    // 같은 요일 8주: 100,102,98,101,99,100,103,97 → 중앙값 100, MAD 1.5
    const weekly = [97, 103, 100, 99, 101, 98, 102, 100];
    const points = weekly.map((v, i) => ({ date: addDays(T, -7 * (8 - i)), value: v })).concat([{ date: T, value: 70 }]);
    const s = detectValueChange('orders', '주문', points, T);
    expect(s.baseline).toBe(100);
    expect(s.z).toBeCloseTo((0.6745 * -30) / 1.5, 9);
    expect(s.relativeChange).toBeCloseTo(-0.3, 12);
    expect(s.verdict).toBe('down');
  });

  it('통계적으로 튀어도 15% 미만이면 피드에 올리지 않는다(실무 유의)', () => {
    const weekly = [100, 100.2, 99.8, 100.1, 99.9, 100, 100.3, 99.7];
    const points = weekly.map((v, i) => ({ date: addDays(T, -7 * (8 - i)), value: v })).concat([{ date: T, value: 110 }]);
    const s = detectValueChange('orders', '주문', points, T);
    expect(Math.abs(s.z!)).toBeGreaterThan(3.5);
    expect(s.verdict).toBe('normal');
  });

  it('같은 요일 기준이 4주 미만이면 판정하지 않는다', () => {
    const points = [1, 2, 3].map((w) => ({ date: addDays(T, -7 * w), value: 100 })).concat([{ date: T, value: 1 }]);
    expect(detectValueChange('orders', '주문', points, T).verdict).toBe('insufficient');
  });

  it('요일 패턴(주말에만 높음)은 같은 요일끼리 비교하므로 경보가 아니다', () => {
    // 토요일만 300, 나머지 100. 대상이 토요일(3/13)이어도 평소대로면 normal.
    const sat = '2027-03-13';
    const pts = Array.from({ length: 60 }, (_, i) => {
      const date = addDays(sat, -59 + i);
      const isSat = new Date(`${date}T00:00:00Z`).getUTCDay() === 6;
      return { date, value: (isSat ? 300 : 100) + (i % 3) };
    });
    expect(detectValueChange('orders', '주문', pts, sat).verdict).toBe('normal');
  });
});

describe('detectRateChange', () => {
  it('기준 비율 대비 두 비율 z — 하루 세션이 충분할 때만', () => {
    // 기준 4주 각 2,000세션·40주문(2%), 어제 2,000세션·20주문(1%)
    const pts = [1, 2, 3, 4].map((w) => ({ date: addDays(T, -7 * w), numerator: 40, denominator: 2000 }));
    pts.push({ date: T, numerator: 20, denominator: 2000 });
    const s = detectRateChange('cvr', '주문 전환율', pts, T);
    expect(s.baseline).toBeCloseTo(0.02, 12);
    expect(s.z).toBeCloseTo((0.01 - 0.02) / Math.sqrt((0.02 * 0.98) / 2000), 9);
    expect(s.verdict).toBe('down');
  });

  it('기대 건수가 10 미만이면 정규근사가 성립하지 않아 판정하지 않는다', () => {
    const pts = [1, 2, 3, 4].map((w) => ({ date: addDays(T, -7 * w), numerator: 4, denominator: 200 }));
    pts.push({ date: T, numerator: 0, denominator: 200 });
    const s = detectRateChange('cvr', '주문 전환율', pts, T);
    expect(s.verdict).toBe('insufficient');
    expect(s.note).toContain('판정하지 않습니다');
  });
});

describe('weekly', () => {
  it('7일 합은 겹치지 않는 주로 접고, 빈 날이 있는 주는 버린다', () => {
    const pts = series(() => 1);
    const w = weeklyTotals(pts, T, 3);
    expect(w).toEqual([
      { date: T, value: 7 },
      { date: addDays(T, -7), value: 7 },
      { date: addDays(T, -14), value: 7 },
    ]);
    expect(weeklyTotals(pts.slice(1), addDays(T, -56 + 6), 1)).toEqual([]);
  });

  it('최근 7일 합이 그 앞 주들보다 크게 낮으면 주간 down', () => {
    const pts = series((i) => (i >= 50 ? 50 : 100 + (i % 3) * 5));
    const s = detectWeeklyValueChange('revenue', '순매출', pts, T);
    expect(s.window).toBe('week');
    expect(s.verdict).toBe('down');
  });

  it('기준 주들이 거의 같아 MAD 가 0 이어도 큰 하락을 놓치지 않는다 (평균 절대편차 대안식)', () => {
    // 주 합계 704·703 번갈아 → MAD 0, 평균 절대편차 3/7
    const pts = series((i) => (i >= 50 ? 50 : 100 + (i % 2)));
    const s = detectWeeklyValueChange('revenue', '순매출', pts, T);
    expect(s.baseline).toBe(704);
    expect(s.z).toBeCloseTo((350 - 704) / (1.253314 * (3 / 7)), 6);
    expect(s.verdict).toBe('down');
  });

  it('기준이 완전히 일정하면 상대 변화만으로 판정한다', () => {
    const flat = [1, 2, 3, 4].map((w) => ({ date: addDays(T, -7 * w), value: 100 }));
    expect(detectValueChange('o', '주문', [...flat, { date: T, value: 80 }], T)).toMatchObject({ verdict: 'down', z: null });
    expect(detectValueChange('o', '주문', [...flat, { date: T, value: 95 }], T)).toMatchObject({ verdict: 'normal' });
  });
});
