/**
 * 발급 다이얼로그의 로그인아이디/이메일 조회 결과 판정 — **순수 함수**.
 *
 * `.tsx` 안에 있으면 admin-web 의 jest transform(`^.+\.(t|j)s$`) 밖이라 테스트가 실행조차
 * 되지 않는다(#488 Task 12 리뷰 Important #2). 비동기 API 호출(user-service 조회)은
 * 다이얼로그에 남기고, 「0건=못 찾음 / 1건=해결 / 2건 이상=모호」 판정만 여기로 뺀다.
 */

export type LookupOutcome<T> =
  | { kind: 'resolved'; match: T }
  | { kind: 'not_found' }
  | { kind: 'ambiguous' };

export function classifyLookupMatches<T>(matches: T[]): LookupOutcome<T> {
  if (matches.length === 0) return { kind: 'not_found' };
  if (matches.length > 1) return { kind: 'ambiguous' };
  return { kind: 'resolved', match: matches[0] };
}
