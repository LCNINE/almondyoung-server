import { and, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

export interface DailyCountPoint {
  bucket: string;
  count: number;
}

/** timezone 없는 UTC timestamp 컬럼을 KST 달력일 문자열로 */
export function kstDaySql(column: PgColumn): SQL<string> {
  return sql<string>`(((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date)::text`;
}

export function kstDayRangeCondition(column: PgColumn, from: string, to: string): SQL | undefined {
  return and(
    gte(column, sql`((${from}::date)::timestamp AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'`),
    lt(column, sql`((${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'`),
  );
}

export function buildDailyCountSeries(rows: Array<{ day: string; count: number }>, from: string, to: string): DailyCountPoint[] {
  const countByDay = new Map(rows.map((row) => [row.day, Number(row.count)]));
  const series: DailyCountPoint[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    const bucket = cursor.toISOString().slice(0, 10);
    series.push({ bucket, count: countByDay.get(bucket) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}
