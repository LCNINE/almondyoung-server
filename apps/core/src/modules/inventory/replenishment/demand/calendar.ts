/**
 * 'YYYY-MM-DD' 달력일 산술. Date.UTC 위에서만 계산하므로 런타임 TZ(jest · ECS 는 UTC, 개발 머신은 KST)에
 * 결과가 흔들리지 않는다. 순수 함수 — Nest · drizzle 을 모른다.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtcMs(iso: string): number {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`YYYY-MM-DD 가 아니다: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  return fromUtcMs(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) === s;
}

export function addDays(iso: string, days: number): string {
  return fromUtcMs(toUtcMs(iso) + days * DAY_MS);
}

/** to − from (일). 같은 날 0. */
export function dayDiff(fromIso: string, toIso: string): number {
  return Math.round((toUtcMs(toIso) - toUtcMs(fromIso)) / DAY_MS);
}

/** 순간 → Asia/Seoul 달력일. DST 가 없는 고정 +09:00. */
export function kstDateOf(instant: Date): string {
  return fromUtcMs(instant.getTime() + KST_OFFSET_MS);
}
