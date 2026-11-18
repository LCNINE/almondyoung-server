// 매칭 화면의 날짜는 «한국 달력일»(YYYY-MM-DD)로 주고받는다. 서버가 그 날짜를 한국 00:00~23:59 로 읽는다.

const KST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 지금 한국 날짜. */
export function kstToday(now: Date = new Date()): string {
  return KST_DATE.format(now);
}

/** 날짜 선택기가 준 날(브라우저 기준 그날 00:00)을 그 달력일 그대로. */
export function dateKeyOf(day: Date): string {
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const d = String(day.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** YYYY-MM-DD 를 날짜 선택기에 넘길 그날 00:00(브라우저 기준)으로. */
export function dateOfKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
