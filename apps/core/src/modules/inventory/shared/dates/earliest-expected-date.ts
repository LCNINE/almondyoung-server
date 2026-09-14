/**
 * 예정일은 더 이상 헤더 컬럼이 아니다. 발주 헤더와 입고 계획 둘 다 **"아직 안 들어온
 * 것 중 가장 이른 날짜"** 라는 같은 규칙이라 함수 하나를 나눠 쓴다.
 *
 * 다만 *무엇이 "아직 안 들어온 것"인지*는 자리마다 다르고, **그 필터는 호출자가 건다**:
 *
 * - 입고 계획: 아직 `pending` 인 아이템 (`inbound.service.ts`)
 * - 발주 헤더: 실제로 발주된(`ordered`) 라인 (`purchaseOrderExpectedArrival`)
 *
 * 예전 이 자리에는 발주 헤더가 *"라인 ETA 중 가장 이른 날짜"* 라고 적혀 있었다. 필터가
 * 빠진 그 문장 자체가 버그였다 — 끝내 못 산(`unavailable`) 라인의 예정일이 발주 전체의
 * 입고 예정일 행세를 해서, 같은 발주를 발주 목록과 입고 대기가 다른 날짜로 말했다
 * (2026-08-26 dev 스모크에서 발견).
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
