export interface DailyOrderStatusPoint {
  bucket: string;
  pending: number;
  preparing: number;
  shipping: number;
  delivered: number;
  cancelled: number;
  exchange: number;
  return: number;
  total: number;
}

type OrderRow = Pick<DailyOrderStatusPoint, 'pending' | 'preparing' | 'shipping' | 'delivered' | 'cancelled' | 'total'> & {
  day: string;
};

export function buildDailyOrderStatusSeries(
  orders: OrderRow[],
  exchanges: Array<{ day: string; count: number }>,
  returns: Array<{ day: string; count: number }>,
  from: string,
  to: string,
): DailyOrderStatusPoint[] {
  const orderByDay = new Map(orders.map((row) => [row.day, row]));
  const exchangeByDay = new Map(exchanges.map((row) => [row.day, row.count]));
  const returnByDay = new Map(returns.map((row) => [row.day, row.count]));
  const series: DailyOrderStatusPoint[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    const bucket = cursor.toISOString().slice(0, 10);
    const row = orderByDay.get(bucket);
    series.push({
      bucket,
      pending: row?.pending ?? 0,
      preparing: row?.preparing ?? 0,
      shipping: row?.shipping ?? 0,
      delivered: row?.delivered ?? 0,
      cancelled: row?.cancelled ?? 0,
      exchange: exchangeByDay.get(bucket) ?? 0,
      return: returnByDay.get(bucket) ?? 0,
      total: row?.total ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}
