/**
 * 데이터 기준 시각 — "이 숫자가 언제 기준인지".
 *
 * 서버(ECS)·CI 는 UTC 로, 개발 머신은 Asia/Seoul 로 뜬다. 브라우저 시간대도 관리자마다 다를 수 있다.
 * 그래서 런타임 시간대에 기대는 포맷(`toLocaleString()` 인자 없이, `date-fns/format`)을 쓰지 않고
 * **`Asia/Seoul` 을 명시**해 어디서 렌더하든 같은 문자열이 나오게 한다.
 */

const KST = 'Asia/Seoul';

const KST_DATE_TIME = new Intl.DateTimeFormat('ko-KR', {
  timeZone: KST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO 순간 → `2026-08-28 10:00` (KST). 값이 없거나 파싱 불가면 null. */
export function formatKstDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = KST_DATE_TIME.formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

/** 기준 시각 배지 문구. 없으면 null 이라 화면이 배지를 아예 안 그린다. */
export function asOfLabel(iso: string | null | undefined): string | null {
  const formatted = formatKstDateTime(iso);
  return formatted ? `${formatted} 기준` : null;
}

/**
 * 기준 시각이 지금보다 얼마나 뒤처졌나 — 집계가 밀리면 화면 숫자가 과거를 가리킨다.
 * `null` 은 "판단 불가"(기준 시각 없음)이고, 음수는 시계 오차이므로 0 으로 눕힌다.
 */
export function stalenessMinutes(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
}

/**
 * 지연이 눈에 띌 때만 문구를 준다. 몇 분 지연은 정상이라 매번 경고하면 경고가 무뎌진다.
 * 임계는 30분 — 주문 이벤트 소비가 그보다 밀리면 사람이 알아야 한다.
 */
export const STALENESS_WARN_MINUTES = 30;

export function stalenessNote(iso: string | null | undefined, now: Date = new Date()): string | null {
  const minutes = stalenessMinutes(iso, now);
  if (minutes == null || minutes < STALENESS_WARN_MINUTES) return null;
  if (minutes < 60) return `집계가 ${minutes}분 밀려 있습니다`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `집계가 ${hours}시간 밀려 있습니다`;
  return `집계가 ${Math.floor(hours / 24)}일 밀려 있습니다`;
}

const KST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * 오늘의 KST 달력일(YYYY-MM-DD). 브라우저 시간대가 서울이 아니어도 같은 날을 가리킨다 —
 * 서버 집계가 전부 KST 달력일 귀속이라 화면의 "오늘"이 어긋나면 표가 하루 밀린다.
 * en-CA 로케일이 YYYY-MM-DD 를 준다.
 */
export function kstToday(now: Date = new Date()): string {
  return KST_DATE.format(now);
}

/** KST 기준 n일 전 달력일. 날짜 산술은 UTC 로 해 오프셋에 하루가 밀리지 않게 한다. */
export function kstDaysAgo(days: number, now: Date = new Date()): string {
  const anchor = new Date(`${kstToday(now)}T00:00:00.000Z`);
  anchor.setUTCDate(anchor.getUTCDate() - days);
  return anchor.toISOString().slice(0, 10);
}
