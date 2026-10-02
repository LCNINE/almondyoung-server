const KST_OFFSET_MS = 9 * 3600_000;

/** 알림을 보내지 않는 한국 시간대: 21시부터 다음 날 8시 전까지. 이 시간에 생긴 알림은 8시에 보낸다. */
const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 8;

const kstParts = (value: string | Date) => {
  const kst = new Date(new Date(value).getTime() + KST_OFFSET_MS);
  return { month: kst.getUTCMonth() + 1, day: kst.getUTCDate() };
};

/** '2026-09-03T00:00:00Z' · '2026-09-03' → '9월 3일' (한국 날짜) */
export function formatKstMonthDay(value: string): string {
  const { month, day } = kstParts(value);
  return `${month}월 ${day}일`;
}

/** 청구 주기 표기. 해를 넘기면 끝 날짜에 연도를 붙인다. 모르면 '이번 주기'. */
export function formatBillingPeriod(periodStart?: string, periodEnd?: string): string {
  if (!periodStart || !periodEnd) return '이번 주기';
  const startYear = Number(periodStart.slice(0, 4));
  const endYear = Number(periodEnd.slice(0, 4));
  const end = formatKstMonthDay(periodEnd);
  return `${formatKstMonthDay(periodStart)}~${endYear !== startYear ? `${endYear}년 ` : ''}${end}`;
}

/**
 * 발송 시각. 한국 시간 21시~8시 사이면 가장 가까운 8시로 미룬다.
 * 정보성 알림이라 법적 야간 제한 대상은 아니지만, 결제 실패를 한밤중에 받는 것은 불안만 키운다.
 */
export function nextSendableAt(now: Date): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const hour = kst.getUTCHours();
  if (hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR) return now;
  const eightKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), QUIET_END_HOUR);
  const target = hour >= QUIET_START_HOUR ? eightKst + 86_400_000 : eightKst;
  return new Date(target - KST_OFFSET_MS);
}

/**
 * NHN 예약 발송 시각(`requestDate`, 한국 시간 `yyyy-MM-dd HH:mm`). 지금 보내도 되는 시간이면 null — 즉시 발송.
 * 예약은 NHN 이 들고 있으므로 우리 쪽 큐가 없어도 아침에 나간다(문자 대체 발송도 같은 시각).
 */
export function nhnRequestDateIfQuiet(now: Date): string | null {
  const at = nextSendableAt(now);
  if (at.getTime() === now.getTime()) return null;
  const kst = new Date(at.getTime() + KST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
}
