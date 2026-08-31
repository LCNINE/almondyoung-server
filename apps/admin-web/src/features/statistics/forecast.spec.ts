import { buildTrendChart, forecastDaily } from './forecast';

const OPTIONS = { today: '2026-08-28', basisDays: 14, horizonDays: 2 };

describe('forecastDaily', () => {
  it('직선 위의 관측이면 추세를 그대로 연장한다', () => {
    const result = forecastDaily(
      [
        { bucket: '2026-08-25', value: 100 },
        { bucket: '2026-08-26', value: 200 },
        { bucket: '2026-08-27', value: 300 },
      ],
      OPTIONS,
    );

    expect(result).not.toBeNull();
    expect(result!.slopePerDay).toBe(100);
    expect(result!.points).toEqual([
      { bucket: '2026-08-29', value: 500, lower: 500, upper: 500 },
      { bucket: '2026-08-30', value: 600, lower: 600, upper: 600 },
    ]);
    expect(result!.total).toBe(1100);
  });

  it('오늘 관측은 하루가 안 끝났으므로 추세 계산에서 뺀다', () => {
    const withoutToday = forecastDaily(
      [
        { bucket: '2026-08-25', value: 100 },
        { bucket: '2026-08-26', value: 200 },
        { bucket: '2026-08-27', value: 300 },
      ],
      OPTIONS,
    );
    const withToday = forecastDaily(
      [
        { bucket: '2026-08-25', value: 100 },
        { bucket: '2026-08-26', value: 200 },
        { bucket: '2026-08-27', value: 300 },
        { bucket: '2026-08-28', value: 5 },
      ],
      OPTIONS,
    );

    expect(withToday).toEqual(withoutToday);
  });

  it('근거 기간보다 오래된 관측은 추세에 넣지 않는다', () => {
    const result = forecastDaily(
      [
        { bucket: '2026-08-01', value: 9_999_999 },
        { bucket: '2026-08-25', value: 100 },
        { bucket: '2026-08-26', value: 200 },
        { bucket: '2026-08-27', value: 300 },
      ],
      OPTIONS,
    );

    expect(result!.slopePerDay).toBe(100);
    expect(result!.basisCount).toBe(3);
  });

  it('판매가 없어 빠진 날이 있어도 순번이 아니라 날짜 간격으로 기울기를 잡는다', () => {
    const result = forecastDaily(
      [
        { bucket: '2026-08-20', value: 0 },
        { bucket: '2026-08-24', value: 40 },
        { bucket: '2026-08-26', value: 60 },
      ],
      OPTIONS,
    );

    // 순번(0,1,2)으로 회귀하면 기울기가 30 이 된다 — 날짜 간격을 쓰면 10 이다
    expect(result!.slopePerDay).toBeCloseTo(10, 10);
    expect(result!.points.map((p) => p.value)).toEqual([90, 100]);
  });

  it('관측이 3일 미만이면 예측하지 않는다', () => {
    const result = forecastDaily(
      [
        { bucket: '2026-08-26', value: 100 },
        { bucket: '2026-08-27', value: 200 },
      ],
      OPTIONS,
    );

    expect(result).toBeNull();
  });

  it('관측이 흩어져 있으면 예측 범위가 생기고 멀어질수록 넓어진다', () => {
    const result = forecastDaily(
      [
        { bucket: '2026-08-24', value: 100 },
        { bucket: '2026-08-25', value: 300 },
        { bucket: '2026-08-26', value: 150 },
        { bucket: '2026-08-27', value: 400 },
      ],
      { ...OPTIONS, horizonDays: 3 },
    );

    const widths = result!.points.map((p) => p.upper - p.lower);
    expect(widths[0]).toBeGreaterThan(0);
    expect(widths[1]).toBeGreaterThan(widths[0]);
    expect(widths[2]).toBeGreaterThan(widths[1]);
    result!.points.forEach((p) => {
      expect(p.lower).toBeLessThan(p.value);
      expect(p.upper).toBeGreaterThan(p.value);
    });
    expect(result!.totalLower).toBeLessThan(result!.total);
    expect(result!.totalUpper).toBeGreaterThan(result!.total);
  });
});

describe('buildTrendChart', () => {
  const series = [
    { bucket: '2026-08-25', netRevenue: 100, estimatedMargin: 10 },
    { bucket: '2026-08-26', netRevenue: 200, estimatedMargin: 20 },
    { bucket: '2026-08-27', netRevenue: 300, estimatedMargin: 30 },
  ];

  it('실적 행의 기존 값은 그대로 두고 예측 칸만 더한다', () => {
    const { rows } = buildTrendChart(series, OPTIONS);

    expect(
      rows
        .slice(0, series.length)
        .map(({ bucket, netRevenue, estimatedMargin }) => ({ bucket, netRevenue, estimatedMargin })),
    ).toEqual(series);
  });

  it('예측 칸은 마지막 실적 점부터 채워 선이 끊기지 않게 한다', () => {
    const { rows } = buildTrendChart(series, OPTIONS);

    expect(rows[0].netRevenueForecast).toBeUndefined();
    expect(rows[1].netRevenueForecast).toBeUndefined();
    expect(rows[2].netRevenueForecast).toBe(300);
    expect(rows[2].netRevenueBand).toEqual([300, 300]);
    expect(rows[2].estimatedMarginForecast).toBe(30);
  });

  it('예측 행에는 실적 값이 없다', () => {
    const { rows } = buildTrendChart(series, OPTIONS);

    expect(rows).toHaveLength(series.length + OPTIONS.horizonDays);
    rows.slice(series.length).forEach((row) => {
      expect(row.netRevenue).toBeUndefined();
      expect(row.estimatedMargin).toBeUndefined();
      expect(row.netRevenueForecast).toEqual(expect.any(Number));
    });
  });

  it('추세를 못 뽑으면 실적만 그대로 내보낸다', () => {
    const { rows, revenue, margin } = buildTrendChart(series.slice(0, 2), OPTIONS);

    expect(revenue).toBeNull();
    expect(margin).toBeNull();
    expect(rows).toEqual(series.slice(0, 2));
  });

  it('빈 시리즈면 행도 비어 있다', () => {
    expect(buildTrendChart([], OPTIONS)).toEqual({ rows: [], revenue: null, margin: null });
  });
});
