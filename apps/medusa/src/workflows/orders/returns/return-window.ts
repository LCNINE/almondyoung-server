const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;
const WINDOW_DAYS = 7;

/**
 * 고객 반품 기한(N4) — 배송완료일의 KST 날짜 + 7일의 23:59:59.999 KST.
 * 런타임 TZ(jest 는 UTC, 라이브도 UTC)에 기대지 않게 +9h 고정 산술로 계산한다. 한국은 서머타임이 없다.
 */
export function returnWindowEndsAt(deliveredAt: Date): Date {
  const kstDayStart = Math.floor((deliveredAt.getTime() + KST_OFFSET_MS) / DAY_MS) * DAY_MS;
  const kstEnd = kstDayStart + (WINDOW_DAYS + 1) * DAY_MS - 1;
  return new Date(kstEnd - KST_OFFSET_MS);
}
