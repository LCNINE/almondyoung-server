import {
  COHORT_MONTHS,
  FREQUENCY_BUCKETS,
  RECENCY_BUCKETS,
  addMonths,
  buildCohortMatrix,
  buildSegments,
  monthDiff,
  segmentOf,
} from './customer-insights.query';

describe('addMonths / monthDiff', () => {
  it('연 경계를 넘는다', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -2)).toBe('2025-11');
    expect(monthDiff('2025-11', '2026-02')).toBe(3);
  });
});

describe('buildCohortMatrix', () => {
  it('활동 없는 칸은 0, 아직 오지 않은 달은 null 로 채운다', () => {
    const rows = buildCohortMatrix(
      [{ cohortMonth: '2026-06', size: 4 }],
      [
        { cohortMonth: '2026-06', activeMonth: '2026-06', customers: 4 },
        { cohortMonth: '2026-06', activeMonth: '2026-08', customers: 1 },
      ],
      '2026-08',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].retention.slice(0, 3)).toEqual([1, 0, 0.25]);
    expect(rows[0].retention.slice(3)).toEqual(Array(COHORT_MONTHS - 3).fill(null));
  });

  it('코호트 월 오름차순으로 정렬한다', () => {
    const rows = buildCohortMatrix(
      [
        { cohortMonth: '2026-08', size: 1 },
        { cohortMonth: '2026-07', size: 2 },
      ],
      [],
      '2026-08',
    );
    expect(rows.map((row) => row.cohortMonth)).toEqual(['2026-07', '2026-08']);
  });
});

describe('segmentOf', () => {
  it('모든 R×F 셀이 정확히 하나의 세그먼트에 속한다', () => {
    const keys = new Set<string>();
    for (let r = 0; r < RECENCY_BUCKETS.length; r += 1) {
      for (let f = 0; f < FREQUENCY_BUCKETS.length; f += 1) {
        keys.add(segmentOf(r, f));
      }
    }
    expect([...keys].sort()).toEqual(['at-risk', 'dormant', 'loyal', 'new', 'one-time', 'vip']);
  });

  it('대표 케이스 — 최근·다구매는 VIP, 오래된 고객은 휴면', () => {
    expect(segmentOf(0, 3)).toBe('vip');
    expect(segmentOf(0, 0)).toBe('new');
    expect(segmentOf(2, 2)).toBe('at-risk');
    expect(segmentOf(4, 3)).toBe('dormant');
  });
});

describe('buildSegments', () => {
  it('셀 고객 수 합이 세그먼트 합과 같다 (누락·중복 없음)', () => {
    const cells = [
      { recency: '30일 이내', frequency: '10회 이상', customers: 3, totalRevenue: 0 },
      { recency: '31~90일', frequency: '2~3회', customers: 5, totalRevenue: 0 },
      { recency: '1년 이상', frequency: '1회', customers: 7, totalRevenue: 0 },
    ];
    const segments = buildSegments(cells);
    expect(segments.reduce((sum, s) => sum + s.customers, 0)).toBe(15);
    expect(segments.find((s) => s.key === 'vip')?.customers).toBe(3);
    expect(segments.find((s) => s.key === 'loyal')?.customers).toBe(5);
    expect(segments.find((s) => s.key === 'dormant')?.customers).toBe(7);
  });
});
