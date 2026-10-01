/** 달력일(YYYY-MM-DD) 산술. 문자열·UTC 로만 다뤄 실행 시간대와 무관하다. */

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(from: string, to: string): number {
  if (to < from) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 월=0 … 일=6 */
export function isoWeekday(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function maxDay(a: string, b: string): string {
  return a > b ? a : b;
}

export function minDay(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * 버킷이 조회 기간에 «일부만» 들어 있는지. 주·월 버킷의 양 끝은 날이 덜 차서 그래프에서 급락처럼 보인다 —
 * 화면은 이런 버킷에 표시를 붙인다. 버킷 라벨은 첫날(일·주, YYYY-MM-DD) 또는 YYYY-MM(월).
 */
export function isPartialBucket(bucket: string, granularity: 'day' | 'week' | 'month', from: string, to: string): boolean {
  if (granularity === 'day') return false;
  const start = granularity === 'month' ? `${bucket}-01` : bucket;
  const end =
    granularity === 'month'
      ? `${bucket}-${String(daysInMonth(Number(bucket.slice(0, 4)), Number(bucket.slice(5, 7)))).padStart(2, '0')}`
      : addDays(bucket, 6);
  return start < from || end > to;
}
