const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

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

/** 다음 영업일(주말 건너뜀) YYYYMMDD. CMS 마감 17:00 기준으로 daysToAdd 결정. */
export function nextCmsPaymentDate(): string {
  const now = kstNow();
  const daysToAdd = now.getUTCHours() < 17 ? 1 : 2;

  const target = new Date(now);
  target.setUTCDate(target.getUTCDate() + daysToAdd);

  while (target.getUTCDay() === 0 || target.getUTCDay() === 6) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return formatYyyymmdd(target);
}

/** D-1 날짜를 YYYYMMDD (KST 기준). CMS 출금 결과 조회 기준일. */
export function kstYesterdayYyyymmdd(): string {
  const yesterday = kstNow();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return formatYyyymmdd(yesterday);
}
