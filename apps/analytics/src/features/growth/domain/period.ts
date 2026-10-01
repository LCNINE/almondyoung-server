import { sql, type SQL } from 'drizzle-orm';
import type { GrowthGranularity } from '../api/growth-query.dto';

/** 달력일 덧셈. 달력 날짜끼리의 산술이라 UTC 로 해도 KST 와 같다. */
export function addDays(dateOnly: string, days: number): string {
  const base = new Date(`${dateOnly}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** 바로 앞의 같은 길이 기간. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const length = daysBetweenInclusive(from, to);
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

/**
 * 그 날이 속한 버킷의 첫날. 주는 ISO 주(월요일 시작), 월은 1일.
 * SQL 의 `date_trunc('week', …)` 도 ISO 주(월요일)라 두 구현이 같은 버킷을 만든다 — 스펙이 이걸 고정한다.
 */
export function bucketStartOf(day: string, granularity: GrowthGranularity): string {
  if (granularity === 'day') return day;
  if (granularity === 'month') return `${day.slice(0, 7)}-01`;
  const d = new Date(`${day}T00:00:00Z`);
  const isoDow = (d.getUTCDay() + 6) % 7; // 월=0 … 일=6
  return addDays(day, -isoDow);
}

/** 화면 버킷 라벨. 일·주는 첫날(YYYY-MM-DD), 월은 YYYY-MM. */
export function bucketLabelOf(day: string, granularity: GrowthGranularity): string {
  const start = bucketStartOf(day, granularity);
  return granularity === 'month' ? start.slice(0, 7) : start;
}

/** SQL: date 식이 속한 버킷의 첫날(date). */
export function bucketStart(dateExpr: SQL, granularity: GrowthGranularity): SQL {
  if (granularity === 'day') return sql`(${dateExpr})::date`;
  return sql`(date_trunc(${granularity}, (${dateExpr})::timestamp))::date`;
}

/** SQL: 버킷 첫날(date) → 라벨. `bucketLabelOf` 와 같은 모양. */
export function bucketLabel(startExpr: SQL, granularity: GrowthGranularity): SQL {
  return granularity === 'month' ? sql`to_char(${startExpr}, 'YYYY-MM')` : sql`to_char(${startExpr}, 'YYYY-MM-DD')`;
}

/** from~to 사이 모든 버킷 라벨(빈 버킷을 0 으로 채우는 축). */
export function bucketLabels(from: string, to: string, granularity: GrowthGranularity): string[] {
  const labels: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const label = bucketLabelOf(day, granularity);
    if (labels[labels.length - 1] !== label) labels.push(label);
  }
  return labels;
}
