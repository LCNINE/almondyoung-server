/**
 * "오늘의 매출" 현황판의 계산부. 컴포넌트 밖 순수 함수로 두고 스펙으로 고정한다 —
 * 평균·합계는 눈으로 검산할 수 없는 종류의 숫자다.
 *
 * **세 축의 모수가 서로 다르다. 화면 문구가 이걸 밝혀야 한다.**
 * - 주문: analytics 주문 집계. 주문이 **들어온 날**에 귀속된 총매출(취소·환불 미차감).
 * - 결제: wallet 캡처 성공. **돈이 실제로 들어온 날**에 귀속.
 * - 환불: wallet 환불 성공. **환불이 나간 날**에 귀속.
 *
 * 같은 주문이 주문일과 결제일이 다를 수 있어 세 축의 합은 서로 맞지 않는다. 그게 정상이다.
 */

export interface SalesDailyPoint {
  date: string;
  orderAmount: number;
  orderCount: number;
  paidAmount: number;
  paidCount: number;
  refundAmount: number;
  refundCount: number;
}

export interface SalesCell {
  amount: number;
  count: number;
}

export type SalesRowKind = 'day' | 'average' | 'total';

export interface SalesTableRow {
  key: string;
  label: string;
  kind: SalesRowKind;
  isToday: boolean;
  order: SalesCell;
  paid: SalesCell;
  refund: SalesCell;
}

interface DailySource {
  bucket: string;
  grossRevenue: number;
  ordersCount: number;
}

interface PaymentSource {
  bucket: string;
  capturedAmount: number;
  capturedCount: number;
  refundedAmount: number;
  refundedCount: number;
}

/** from~to(포함)의 달력일. UTC 로 순회해 오프셋에 하루가 밀리지 않게 한다. */
export function eachDate(from: string, to: string): string[] {
  if (from > to) return [];
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * 두 서비스의 일별 시리즈를 날짜로 맞춘다. 한쪽에만 있는 날은 다른 쪽을 0 으로 둔다 —
 * 주문은 있는데 아직 결제가 안 잡힌 날이 실제로 있고, 그 날을 통째로 빼면 표가 거짓말을 한다.
 */
export function mergeDailySales(
  orders: DailySource[],
  payments: PaymentSource[],
  from: string,
  to: string,
): SalesDailyPoint[] {
  const orderByDate = new Map(orders.map((row) => [row.bucket, row]));
  const paymentByDate = new Map(payments.map((row) => [row.bucket, row]));
  return eachDate(from, to).map((date) => {
    const order = orderByDate.get(date);
    const payment = paymentByDate.get(date);
    return {
      date,
      orderAmount: order?.grossRevenue ?? 0,
      orderCount: order?.ordersCount ?? 0,
      paidAmount: payment?.capturedAmount ?? 0,
      paidCount: payment?.capturedCount ?? 0,
      refundAmount: payment?.refundedAmount ?? 0,
      refundCount: payment?.refundedCount ?? 0,
    };
  });
}

function sumCells(points: SalesDailyPoint[]): { order: SalesCell; paid: SalesCell; refund: SalesCell } {
  return points.reduce(
    (acc, point) => ({
      order: { amount: acc.order.amount + point.orderAmount, count: acc.order.count + point.orderCount },
      paid: { amount: acc.paid.amount + point.paidAmount, count: acc.paid.count + point.paidCount },
      refund: { amount: acc.refund.amount + point.refundAmount, count: acc.refund.count + point.refundCount },
    }),
    {
      order: { amount: 0, count: 0 },
      paid: { amount: 0, count: 0 },
      refund: { amount: 0, count: 0 },
    },
  );
}

/**
 * 평균은 **조회한 날 수**로 나눈다 — 매출이 0인 날을 분모에서 빼면 평균이 실제보다 부풀려진다.
 * 나눌 날이 없으면 0.
 */
function averageCells(points: SalesDailyPoint[]): { order: SalesCell; paid: SalesCell; refund: SalesCell } {
  const totals = sumCells(points);
  const days = points.length;
  if (days === 0) return totals;
  const divide = (cell: SalesCell): SalesCell => ({
    amount: Math.round(cell.amount / days),
    count: Math.round(cell.count / days),
  });
  return { order: divide(totals.order), paid: divide(totals.paid), refund: divide(totals.refund) };
}

/** `2026-08-28` → `08월 28일`. 문자열 산술이라 실행 시간대와 무관하다. */
export function formatDayLabel(date: string): string {
  return `${date.slice(5, 7)}월 ${date.slice(8, 10)}일`;
}

/** 표 마지막 n일치만 가져온다. 데이터가 더 짧으면 있는 만큼. */
function lastDays(points: SalesDailyPoint[], days: number): SalesDailyPoint[] {
  return points.slice(Math.max(0, points.length - days));
}

export interface SalesTableOptions {
  /** 일자별로 보여줄 최근 며칠. 기본 3일 — 그 위는 평균·합계 행이 답한다. */
  dayRows?: number;
}

/**
 * 카페24 "기간별 매출"에 대응하는 표.
 * 최근 며칠은 일자별로, 그 위는 7일·30일의 평균과 합계로 접는다 —
 * 날짜를 30줄 늘어놓는 것보다 "요즘 하루 평균 얼마"가 판단에 쓰인다.
 */
export function buildSalesTable(
  points: SalesDailyPoint[],
  today: string,
  options: SalesTableOptions = {},
): SalesTableRow[] {
  const dayRows = options.dayRows ?? 3;
  const rows: SalesTableRow[] = lastDays(points, dayRows).map((point) => ({
    key: point.date,
    label: formatDayLabel(point.date),
    kind: 'day' as const,
    isToday: point.date === today,
    order: { amount: point.orderAmount, count: point.orderCount },
    paid: { amount: point.paidAmount, count: point.paidCount },
    refund: { amount: point.refundAmount, count: point.refundCount },
  }));

  const windows: Array<{ days: number; label: string }> = [
    { days: 7, label: '최근 7일' },
    { days: 30, label: '최근 30일' },
  ];
  for (const window of windows) {
    const slice = lastDays(points, window.days);
    // 조회 기간보다 긴 창은 만들지 않는다 — 14일치로 "최근 30일"을 쓰면 거짓말이 된다.
    if (slice.length < window.days) continue;
    rows.push({ key: `${window.days}-average`, label: `${window.label} 평균`, kind: 'average', isToday: false, ...averageCells(slice) });
    rows.push({ key: `${window.days}-total`, label: `${window.label} 합계`, kind: 'total', isToday: false, ...sumCells(slice) });
  }
  return rows;
}
