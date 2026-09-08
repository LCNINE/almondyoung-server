import { assignGrades, computeDemandProfile, DemandPoint } from './demand-profile.calculator';
import { addDays } from './calendar';

const windows = {
  today: '2026-09-08',
  classificationWindowDays: 365,
  paramWindowDaysFrequent: 90,
  paramWindowDaysSparse: 365,
};
const thresholds = { adiThreshold: 1.32, cv2Threshold: 0.49, minDemandEvents: 3 };

/** from 부터 count 일 연속, i 번째 날 수량 qtyAt(i) */
function daily(from: string, count: number, qtyAt: (i: number) => number): DemandPoint[] {
  return Array.from({ length: count }, (_, i) => ({ date: addDays(from, i), qty: qtyAt(i) }));
}
/** from 부터 every 일 간격으로 count 회 */
function every(from: string, stepDays: number, count: number, qtyAt: (i: number) => number): DemandPoint[] {
  return Array.from({ length: count }, (_, i) => ({ date: addDays(from, i * stepDays), qty: qtyAt(i) }));
}

describe('computeDemandProfile — 창과 분류', () => {
  it('smooth: 6/1 부터 매일 10개 — 최초 날짜 앞은 창에서 제외돼 history 99', () => {
    const p = computeDemandProfile(
      daily('2026-06-01', 99, () => 10),
      '2026-06-01',
      windows,
      thresholds,
    );
    expect(p.classificationFrom).toBe('2025-09-08');
    expect(p.classificationTo).toBe('2026-09-07');
    expect(p.historyDays).toBe(99);
    expect(p.demandEvents).toBe(99);
    expect(p.adi).toBe(1);
    expect(p.cv2).toBe(0);
    expect(p.pattern).toBe('smooth');
    // 파라미터 창 90 (6/10~9/7), 전부 10 → 평균 10 · 표준편차 0
    expect(p.paramFrom).toBe('2026-06-10');
    expect(p.paramTo).toBe('2026-09-07');
    expect(p.dailyMean).toBe(10);
    expect(p.dailyStd).toBe(0);
    expect(p.dailyMean90).toBe(10);
    expect(p.sizeMean).toBe(10);
    expect(p.sizeStd).toBe(0);
    expect(p.intervalMean).toBe(1);
  });

  it('intermittent: 30일 간격 12회 × 5개 — 파라미터 창은 365, 0인 날 포함 평균', () => {
    const p = computeDemandProfile(
      every('2025-09-08', 30, 12, () => 5),
      '2025-09-08',
      windows,
      thresholds,
    );
    expect(p.historyDays).toBe(365);
    expect(p.demandEvents).toBe(12);
    expect(p.adi).toBeCloseTo(365 / 12, 6);
    expect(p.cv2).toBe(0);
    expect(p.intervalMean).toBe(30);
    expect(p.pattern).toBe('intermittent');
    expect(p.paramFrom).toBe('2025-09-08');
    expect(p.dailyMean).toBeCloseTo(60 / 365, 6);
    expect(p.dailyStd).toBeCloseTo(0.8928, 3);
    // 90일 창(6/10~9/7)엔 7/5 · 8/4 두 번 → 10/90
    expect(p.dailyMean90).toBeCloseTo(10 / 90, 6);
  });

  it('erratic: 매일 1 · 20 번갈아 100일 — CV² 0.83', () => {
    const p = computeDemandProfile(
      daily('2026-05-31', 100, (i) => (i % 2 === 0 ? 1 : 20)),
      '2026-05-31',
      windows,
      thresholds,
    );
    expect(p.adi).toBe(1);
    expect(p.sizeMean).toBe(10.5);
    expect(p.cv2).toBeCloseTo(0.8269, 3);
    expect(p.pattern).toBe('erratic');
    expect(p.paramFrom).toBe('2026-06-10');
  });

  it('lumpy: 30일 간격 12회, 1 · 20 번갈아 — CV² 0.89', () => {
    const p = computeDemandProfile(
      every('2025-09-08', 30, 12, (i) => (i % 2 === 0 ? 1 : 20)),
      '2025-09-08',
      windows,
      thresholds,
    );
    expect(p.adi).toBeCloseTo(365 / 12, 6);
    expect(p.cv2).toBeCloseTo(0.893, 3);
    expect(p.pattern).toBe('lumpy');
    expect(p.paramFrom).toBe('2025-09-08');
  });

  it('insufficient: 발생일 2회', () => {
    const p = computeDemandProfile(
      [
        { date: '2026-01-10', qty: 4 },
        { date: '2026-05-10', qty: 4 },
      ],
      '2026-01-10',
      windows,
      thresholds,
    );
    expect(p.demandEvents).toBe(2);
    expect(p.pattern).toBe('insufficient');
    expect(p.sizeStd).toBe(0);
    expect(p.paramFrom).toBe('2026-06-10'); // insufficient 는 90 창
    expect(p.dailyMean).toBe(0); // 90 창 안 수요 없음
  });

  it('insufficient: 이력 19일 (신상품)', () => {
    const p = computeDemandProfile(
      daily('2026-08-20', 19, () => 3),
      '2026-08-20',
      windows,
      thresholds,
    );
    expect(p.historyDays).toBe(19);
    expect(p.demandEvents).toBe(19);
    expect(p.pattern).toBe('insufficient');
    // 파라미터 창도 최초 날짜로 잘린다 — 19일 평균 3
    expect(p.paramFrom).toBe('2026-08-20');
    expect(p.dailyMean).toBe(3);
  });

  it('none: 시계열 없음 → history 0 · 전부 0/null', () => {
    const p = computeDemandProfile([], null, windows, thresholds);
    expect(p).toMatchObject({
      pattern: 'none',
      historyDays: 0,
      demandEvents: 0,
      adi: null,
      cv2: null,
      dailyMean: 0,
      dailyStd: 0,
      dailyMean90: 0,
      sizeMean: null,
      sizeStd: null,
      intervalMean: null,
    });
  });

  it('none: 창 밖(작년 이전)에만 수요가 있던 SKU → history 365 · 발생 0', () => {
    const p = computeDemandProfile([{ date: '2024-01-01', qty: 9 }], '2024-01-01', windows, thresholds);
    expect(p.historyDays).toBe(365);
    expect(p.demandEvents).toBe(0);
    expect(p.pattern).toBe('none');
  });

  it('none: 신상품 — 유일한 이력이 오늘(분류 창은 어제까지, firstDate 도 오늘) → history 0, paramFrom > paramTo', () => {
    const p = computeDemandProfile([{ date: '2026-09-08', qty: 4 }], '2026-09-08', windows, thresholds);
    expect(p).toMatchObject({
      pattern: 'none',
      historyDays: 0,
      demandEvents: 0,
      adi: null,
      cv2: null,
      dailyMean: 0,
      dailyStd: 0,
      dailyMean90: 0,
      sizeMean: null,
      sizeStd: null,
      intervalMean: null,
      paramFrom: '2026-09-08',
      paramTo: '2026-09-07',
    });
  });

  it('창 밖 점(오늘 · 창 이전)은 세지 않고, 같은 날 점은 합친다', () => {
    const p = computeDemandProfile(
      [
        ...daily('2026-06-01', 99, () => 10),
        { date: '2026-09-08', qty: 999 }, // 오늘 — 분류 창은 어제까지
        { date: '2025-09-07', qty: 999 }, // 창 이전
        { date: '2026-09-07', qty: 5 }, // 9/7 에 10 + 5
      ],
      '2025-09-07',
      windows,
      thresholds,
    );
    expect(p.historyDays).toBe(365); // 최초 날짜가 창보다 앞이면 창 전체
    expect(p.demandEvents).toBe(99);
    expect(p.sizeMean).toBeCloseTo((98 * 10 + 15) / 99, 9);
  });
});

describe('assignGrades — 매출 누적 80/95', () => {
  it('상위 80% 까지 A, 95% 까지 B, 나머지 C — 경계를 넘는 품목은 앞 등급', () => {
    const grades = assignGrades(
      new Map([
        ['a', 800],
        ['b', 150],
        ['c', 50],
      ]),
      { gradeACut: 0.8, gradeBCut: 0.95 },
    );
    expect(grades.get('a')).toBe('A');
    expect(grades.get('b')).toBe('B');
    expect(grades.get('c')).toBe('C');
  });
  it('하나가 90% 를 차지해도 그 하나는 A', () => {
    const grades = assignGrades(
      new Map([
        ['a', 900],
        ['b', 100],
      ]),
      { gradeACut: 0.8, gradeBCut: 0.95 },
    );
    expect(grades.get('a')).toBe('A');
    expect(grades.get('b')).toBe('B');
  });
  it('매출 0(또는 전부 0)은 C', () => {
    expect(
      assignGrades(
        new Map([
          ['a', 0],
          ['b', 0],
        ]),
        { gradeACut: 0.8, gradeBCut: 0.95 },
      ),
    ).toEqual(
      new Map([
        ['a', 'C'],
        ['b', 'C'],
      ]),
    );
    expect(
      assignGrades(
        new Map([
          ['a', 10],
          ['z', 0],
        ]),
        { gradeACut: 0.8, gradeBCut: 0.95 },
      ).get('z'),
    ).toBe('C');
  });
  it('빈 입력', () => {
    expect(assignGrades(new Map(), { gradeACut: 0.8, gradeBCut: 0.95 }).size).toBe(0);
  });
});
