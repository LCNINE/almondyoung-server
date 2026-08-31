import { abandonRateOf, buildAbandonmentSeries } from './payment-abandonment.service';

describe('abandonRateOf', () => {
  it('분모는 결말이 난 것(성공+이탈)뿐이다', () => {
    expect(abandonRateOf(1, 3)).toBeCloseTo(0.75, 10);
  });

  it('결말이 난 게 없으면 null — 0% 로 뭉개지 않는다', () => {
    expect(abandonRateOf(0, 0)).toBeNull();
  });

  it('전부 이탈이면 1', () => {
    expect(abandonRateOf(0, 5)).toBe(1);
  });
});

describe('buildAbandonmentSeries', () => {
  it('데이터가 없는 날도 0 으로 채운다', () => {
    const series = buildAbandonmentSeries(
      [{ bucket: '2032-05-02', outcome: 'ABANDONED', count: 2, amount: 5000 }],
      '2032-05-01',
      '2032-05-03',
    );

    expect(series.map((point) => point.bucket)).toEqual(['2032-05-01', '2032-05-02', '2032-05-03']);
    expect(series[0]).toMatchObject({ attemptedCount: 0, abandonedCount: 0, abandonedAmount: 0 });
    expect(series[1]).toMatchObject({ attemptedCount: 2, abandonedCount: 2, abandonedAmount: 5000 });
  });

  it('같은 날의 결말들을 한 칸으로 합치고 시도 수는 전부를 센다', () => {
    const [point] = buildAbandonmentSeries(
      [
        { bucket: '2032-05-01', outcome: 'SUCCEEDED', count: 3, amount: 30_000 },
        { bucket: '2032-05-01', outcome: 'ABANDONED', count: 2, amount: 20_000 },
        { bucket: '2032-05-01', outcome: 'OPEN', count: 1, amount: 10_000 },
      ],
      '2032-05-01',
      '2032-05-01',
    );

    expect(point).toEqual({
      bucket: '2032-05-01',
      attemptedCount: 6,
      succeededCount: 3,
      abandonedCount: 2,
      openCount: 1,
      // 금액은 이탈분만 싣는다 — 화면이 "이탈 금액"으로 읽는 칸이다
      abandonedAmount: 20_000,
    });
  });

  it('월·연 경계를 넘어도 날짜가 밀리지 않는다', () => {
    const series = buildAbandonmentSeries([], '2032-12-30', '2033-01-02');
    expect(series.map((point) => point.bucket)).toEqual(['2032-12-30', '2032-12-31', '2033-01-01', '2033-01-02']);
  });
});
