const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const CMS_CUTOFF_HOUR_KST = 17;

const DEFAULT_KR_HOLIDAYS = new Set([
  // 2026 public/bank holidays relevant to CMS business-day settlement.
  '20260101',
  '20260216',
  '20260217',
  '20260218',
  '20260301',
  '20260302',
  '20260501',
  '20260505',
  '20260524',
  '20260525',
  '20260603',
  '20260606',
  '20260815',
  '20260817',
  '20260924',
  '20260925',
  '20260926',
  '20260927',
  '20261003',
  '20261005',
  '20261009',
  '20261225',
  // 2027 is included because CMS allows paymentDate within one month and year-end charges can cross years.
  '20270101',
  '20270207',
  '20270208',
  '20270209',
  '20270210',
  '20270301',
  '20270501',
  '20270505',
  '20270513',
  '20270606',
  '20270607',
  '20270815',
  '20270816',
  '20270914',
  '20270915',
  '20270916',
  '20271003',
  '20271004',
  '20271009',
  '20271011',
  '20271225',
]);

export function kstNow(): Date {
  const now = new Date();
  return new Date(now.getTime() + KST_OFFSET_MS);
}

export function formatYyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function configuredHolidaySet(): Set<string> {
  const extra = (process.env.HYOSUNG_CMS_HOLIDAYS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d{8}$/.test(value));

  return new Set([...DEFAULT_KR_HOLIDAYS, ...extra]);
}

export function isCmsBusinessDay(date: Date, holidays = configuredHolidaySet()): boolean {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidays.has(formatYyyymmdd(date));
}

function startOfKstDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function previousCmsBusinessDay(date: Date, holidays: Set<string>): Date {
  let previous = addUtcDays(date, -1);
  while (!isCmsBusinessDay(previous, holidays)) {
    previous = addUtcDays(previous, -1);
  }
  return previous;
}

function cmsCutoffForPaymentDate(paymentDate: Date, holidays: Set<string>): Date {
  const previousBusinessDay = previousCmsBusinessDay(paymentDate, holidays);
  const cutoff = new Date(previousBusinessDay);
  cutoff.setUTCHours(CMS_CUTOFF_HOUR_KST, 0, 0, 0);
  return cutoff;
}

/** 다음 CMS 출금 가능 영업일 YYYYMMDD. 출금일 전 영업일 17:00 마감을 함께 검증한다. */
export function nextCmsPaymentDate(now = kstNow()): string {
  const holidays = configuredHolidaySet();
  let candidate = addUtcDays(startOfKstDate(now), 1);

  while (!isCmsBusinessDay(candidate, holidays) || now >= cmsCutoffForPaymentDate(candidate, holidays)) {
    candidate = addUtcDays(candidate, 1);
  }

  return formatYyyymmdd(candidate);
}

/** D-1 날짜를 YYYYMMDD (KST 기준). CMS 출금 결과 조회 기준일. */
export function kstYesterdayYyyymmdd(): string {
  const yesterday = kstNow();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return formatYyyymmdd(yesterday);
}
