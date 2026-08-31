import { buildSalesTable, eachDate, formatDayLabel, mergeDailySales, SalesDailyPoint } from './sales-table';

function point(date: string, order: number, paid: number, refund = 0): SalesDailyPoint {
  return {
    date,
    orderAmount: order,
    orderCount: order > 0 ? 1 : 0,
    paidAmount: paid,
    paidCount: paid > 0 ? 1 : 0,
    refundAmount: refund,
    refundCount: refund > 0 ? 1 : 0,
  };
}

describe('eachDate', () => {
  it('월을 넘겨도 날짜가 밀리지 않는다', () => {
    expect(eachDate('2026-08-30', '2026-09-01')).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
  });

  it('기간이 뒤집혔으면 빈 배열', () => {
    expect(eachDate('2026-08-31', '2026-08-01')).toEqual([]);
  });
});

describe('formatDayLabel', () => {
  it('문자열 산술이라 실행 시간대와 무관하다', () => {
    expect(formatDayLabel('2026-08-28')).toBe('08월 28일');
    expect(formatDayLabel('2026-01-01')).toBe('01월 01일');
  });
});

describe('mergeDailySales', () => {
  it('두 서비스의 날짜를 맞춘다', () => {
    const merged = mergeDailySales(
      [{ bucket: '2026-08-10', grossRevenue: 100_000, ordersCount: 3 }],
      [{ bucket: '2026-08-10', capturedAmount: 90_000, capturedCount: 2, refundedAmount: 5_000, refundedCount: 1 }],
      '2026-08-10',
      '2026-08-10',
    );
    expect(merged).toEqual([
      {
        date: '2026-08-10',
        orderAmount: 100_000,
        orderCount: 3,
        paidAmount: 90_000,
        paidCount: 2,
        refundAmount: 5_000,
        refundCount: 1,
      },
    ]);
  });

  it('주문만 있고 결제가 아직 안 잡힌 날도 칸을 남긴다 — 통째로 빼면 표가 거짓말을 한다', () => {
    const merged = mergeDailySales(
      [{ bucket: '2026-08-11', grossRevenue: 50_000, ordersCount: 1 }],
      [],
      '2026-08-10',
      '2026-08-11',
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({
      date: '2026-08-10',
      orderAmount: 0,
      orderCount: 0,
      paidAmount: 0,
      paidCount: 0,
      refundAmount: 0,
      refundCount: 0,
    });
    expect(merged[1].orderAmount).toBe(50_000);
    expect(merged[1].paidAmount).toBe(0);
  });

  it('결제만 있고 주문 집계가 없는 날도 남긴다', () => {
    const merged = mergeDailySales(
      [],
      [{ bucket: '2026-08-10', capturedAmount: 7_000, capturedCount: 1, refundedAmount: 0, refundedCount: 0 }],
      '2026-08-10',
      '2026-08-10',
    );
    expect(merged[0].paidAmount).toBe(7_000);
    expect(merged[0].orderAmount).toBe(0);
  });
});

describe('buildSalesTable', () => {
  const thirty = Array.from({ length: 30 }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return point(`2026-08-${day}`, 10_000, 8_000);
  });

  it('기본은 최근 3일을 일자별로 보여준다', () => {
    const rows = buildSalesTable(thirty, '2026-08-30');
    const days = rows.filter((row) => row.kind === 'day');
    expect(days.map((row) => row.key)).toEqual(['2026-08-28', '2026-08-29', '2026-08-30']);
    expect(days[2].label).toBe('08월 30일');
  });

  it('오늘 행에만 isToday 가 선다', () => {
    const rows = buildSalesTable(thirty, '2026-08-30');
    expect(rows.filter((row) => row.isToday).map((row) => row.key)).toEqual(['2026-08-30']);
  });

  it('오늘이 조회 범위 밖이면 어느 행도 오늘이 아니다', () => {
    expect(buildSalesTable(thirty, '2026-09-05').some((row) => row.isToday)).toBe(false);
  });

  it('합계는 창의 날 수만큼 더한 값이다', () => {
    const rows = buildSalesTable(thirty, '2026-08-30');
    const total7 = rows.find((row) => row.key === '7-total');
    expect(total7?.order).toEqual({ amount: 70_000, count: 7 });
    expect(total7?.paid).toEqual({ amount: 56_000, count: 7 });
  });

  it('평균은 매출 0인 날도 분모에 넣는다 — 빼면 평균이 부풀려진다', () => {
    const withZeros = [
      ...Array.from({ length: 6 }, (_, index) => point(`2026-08-2${index + 1}`, 0, 0)),
      point('2026-08-27', 70_000, 70_000),
    ];
    const rows = buildSalesTable(withZeros, '2026-08-27');
    expect(rows.find((row) => row.key === '7-average')?.order).toEqual({ amount: 10_000, count: 0 });
  });

  it('조회 기간이 창보다 짧으면 그 창을 아예 만들지 않는다 — 14일치로 "최근 30일"을 쓰면 거짓말이다', () => {
    const rows = buildSalesTable(thirty.slice(0, 14), '2026-08-14');
    expect(rows.some((row) => row.key === '7-total')).toBe(true);
    expect(rows.some((row) => row.key === '30-total')).toBe(false);
  });

  it('데이터가 하루뿐이면 일자 행 하나만 나온다', () => {
    const rows = buildSalesTable([point('2026-08-10', 1_000, 1_000)], '2026-08-10');
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('day');
  });

  it('데이터가 없으면 빈 표', () => {
    expect(buildSalesTable([], '2026-08-10')).toEqual([]);
  });
});
