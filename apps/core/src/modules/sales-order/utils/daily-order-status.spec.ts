import { buildDailyOrderStatusSeries } from './daily-order-status';

describe('buildDailyOrderStatusSeries', () => {
  it('주문·반품이 없는 날을 0 으로 채워 기간 전체를 준다', () => {
    const series = buildDailyOrderStatusSeries(
      [
        {
          day: '2026-09-15',
          pending: 1,
          preparing: 2,
          shipping: 3,
          delivered: 4,
          externalShipped: 6,
          cancelled: 5,
          total: 21,
        },
      ],
      [{ day: '2026-09-15', count: 1 }],
      '2026-09-14',
      '2026-09-16',
    );
    expect(series.map((point) => point.bucket)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16']);
    expect(series[0]).toMatchObject({ total: 0, externalShipped: 0, return: 0 });
    expect(series[0]).not.toHaveProperty('exchange');
    expect(series[1]).toMatchObject({
      pending: 1,
      preparing: 2,
      shipping: 3,
      delivered: 4,
      externalShipped: 6,
      cancelled: 5,
      total: 21,
      return: 1,
    });
    expect(series[2]).toMatchObject({ return: 0, total: 0 });
  });
});
