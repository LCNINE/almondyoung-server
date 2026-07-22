// 주문 일자 필터/통계는 한국(KST, UTC+9) 달력일 기준이어야 한다.
// order_date 는 timestamptz(UTC 저장)이므로, KST 달력일 경계를 UTC instant 로 변환한다.
// 서버 프로세스 TZ 에 의존하지 않도록 오프셋을 명시적으로 다룬다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** `YYYY-MM-DD`(KST 달력일)의 00:00:00.000 KST 를 UTC Date 로 변환. */
export function kstDayStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000+09:00`);
}

/** `YYYY-MM-DD`(KST 달력일)의 23:59:59.999 KST 를 UTC Date 로 변환 (inclusive 상한). */
export function kstDayEndInclusive(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999+09:00`);
}

/**
 * 현재 시각을 KST 달력일 기준으로 오늘 경계 및 N일 전 시작점을 UTC Date 로 반환.
 * @param daysBack backStart = (오늘 - daysBack)일의 KST 00:00
 */
export function kstTodayRange(daysBack = 0): {
  start: Date;
  end: Date;
  backStart: Date;
} {
  // UTC getter 가 KST 벽시계를 읽도록 오프셋만큼 앞당긴 시각.
  const nowKstWall = new Date(Date.now() + KST_OFFSET_MS);
  const y = nowKstWall.getUTCFullYear();
  const m = nowKstWall.getUTCMonth();
  const d = nowKstWall.getUTCDate();
  return {
    start: new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - KST_OFFSET_MS),
    end: new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - KST_OFFSET_MS),
    backStart: new Date(Date.UTC(y, m, d - daysBack, 0, 0, 0, 0) - KST_OFFSET_MS),
  };
}
