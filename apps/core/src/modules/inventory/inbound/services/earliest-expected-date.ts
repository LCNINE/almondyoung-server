/**
 * 예정일은 더 이상 헤더 컬럼이 아니다 — 발주 헤더는 **라인 ETA 중 가장 이른 날짜**,
 * 입고 계획은 **아직 안 들어온 아이템 예정일 중 가장 이른 날짜**다. 두 자리가 같은
 * 규칙이라 함수 하나를 나눠 쓴다.
 *
 * 컬럼은 `date` + `mode:'string'` 이라 `'YYYY-MM-DD'` 로 온다. 이 모양은 사전순이
 * 곧 시간순이라 문자열 비교로 최소값을 고를 수 있고, `new Date()` 왕복이 없으니
 * 러너 TZ 가 달력 하루를 밀 여지도 없다.
 *
 * 응답 타입은 `Date | null` 을 유지한다 — admin-web 목록 「도착예정일」 컬럼과
 * 물류팀 Tauri 앱 입고 대기 목록이 그렇게 읽는다.
 */
export function earliestExpectedDate(dates: (string | null)[]): Date | null {
  const present = dates.filter((date): date is string => date !== null);
  if (present.length === 0) return null;
  const earliest = present.reduce((min, date) => (date < min ? date : min));
  return new Date(`${earliest}T00:00:00.000Z`);
}
