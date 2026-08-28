import { buildKeywordTrendChart } from './forecast-chart';

const OPTIONS = { today: '2026-08-28', basisDays: 14, horizonDays: 7 };

/** 하루 1씩 늘어나는 빈손 검색 시리즈 */
function risingSeries(days: number, from = '2026-08-14') {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, index) => ({
    bucket: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    count: 100 + index,
    zeroCount: 10 + index,
  }));
}

describe('buildKeywordTrendChart', () => {
  it('실적 칸은 건드리지 않고 예측 칸만 더한다', () => {
    const series = risingSeries(10);
    const chart = buildKeywordTrendChart(series, OPTIONS);

    for (const point of series) {
      const row = chart.rows.find((candidate) => candidate.bucket === point.bucket);
      expect(row?.count).toBe(point.count);
      expect(row?.zeroCount).toBe(point.zeroCount);
    }
  });

  it('실적 뒤에 horizonDays 만큼 예측 행을 잇는다', () => {
    const series = risingSeries(10);
    const chart = buildKeywordTrendChart(series, OPTIONS);

    // 실적 10일 + 예측 7일
    expect(chart.rows).toHaveLength(17);
    expect(chart.zero?.points).toHaveLength(7);
    // 예측 행에는 실적 값이 없다
    expect(chart.rows[16].zeroCount).toBeUndefined();
    expect(chart.rows[16].zeroForecast).toBeDefined();
  });

  it('마지막 실적 점에 예측 칸을 겹쳐 실선과 점선이 끊기지 않게 한다', () => {
    const series = risingSeries(10);
    const chart = buildKeywordTrendChart(series, OPTIONS);
    const anchor = chart.rows[9];

    expect(anchor.zeroForecast).toBe(anchor.zeroCount);
    expect(anchor.zeroBand).toEqual([anchor.zeroCount, anchor.zeroCount]);
  });

  it('예측 범위의 하단을 0 밑으로 내리지 않는다 — 검색 횟수는 음수가 없다', () => {
    // 급격히 줄어드는 시리즈: 회귀 하단이 음수로 내려간다
    const series = Array.from({ length: 10 }, (_, index) => ({
      bucket: new Date(Date.parse('2026-08-14T00:00:00Z') + index * 86_400_000).toISOString().slice(0, 10),
      count: 100,
      zeroCount: Math.max(0, 40 - index * 5),
    }));
    const chart = buildKeywordTrendChart(series, OPTIONS);

    const forecastRows = chart.rows.filter((row) => row.zeroCount === undefined && row.zeroBand);
    expect(forecastRows.length).toBeGreaterThan(0);
    for (const row of forecastRows) {
      expect(row.zeroBand![0]).toBeGreaterThanOrEqual(0);
      expect(row.zeroBand![1]).toBeGreaterThanOrEqual(0);
    }
  });

  it('관측이 3일 미만이면 예측하지 않고 실적만 남긴다', () => {
    const series = risingSeries(2, '2026-08-26');
    const chart = buildKeywordTrendChart(series, OPTIONS);

    expect(chart.zero).toBeNull();
    expect(chart.rows).toHaveLength(2);
    expect(chart.rows.every((row) => row.zeroForecast === undefined)).toBe(true);
  });

  it('시리즈가 비어 있어도 터지지 않는다', () => {
    const chart = buildKeywordTrendChart([], OPTIONS);
    expect(chart.rows).toEqual([]);
    expect(chart.zero).toBeNull();
  });

  it('오늘 관측은 회귀에서 빠진다 — 하루가 안 끝나 과소집계라 추세를 끌어내린다', () => {
    const base = risingSeries(10);
    // 오늘(2026-08-28) 칸에 비정상적으로 낮은 값을 넣어도 예측 기울기가 바뀌면 안 된다
    const withToday = [...base, { bucket: '2026-08-28', count: 1, zeroCount: 0 }];

    const withoutTodaySlope = buildKeywordTrendChart(base, OPTIONS).zero?.slopePerDay;
    const withTodaySlope = buildKeywordTrendChart(withToday, OPTIONS).zero?.slopePerDay;

    expect(withTodaySlope).toBeCloseTo(withoutTodaySlope!);
  });
});
