/**
 * 발급 다이얼로그의 로그인아이디/이메일 조회 결과 판정 — **순수 함수**.
 *
 * `.tsx` 안에 있으면 admin-web 의 jest transform(`^.+\.(t|j)s$`) 밖이라 테스트가 실행조차
 * 되지 않는다(#488 Task 12 리뷰 Important #2). 비동기 API 호출(user-service 조회)은
 * 다이얼로그에 남기고, 판정만 여기로 뺀다.
 *
 * 🔴 **조회는 부분일치(ilike)다.** user-service 의 `q` 는 loginId·email·username·nickname·
 * 전화를 전부 `ilike '%q%'` 로 훑는다. 그래서 「결과가 1건이면 그 사람」은 틀렸다 — 관리자가
 * 이미 삭제된 아이디 `bob` 을 붙여넣거나 그냥 오타를 냈을 때 유일한 히트가 `bobby` 면,
 * 옛 판정은 그것을 「확인됨」으로 표시하고 **남의 계정에 쿠폰을 발급했다.** 실수를 되돌리려면
 * 회수까지 해야 하는데, 관리자는 애초에 틀렸다는 사실을 모른다.
 *
 * 그래서 히트 중 **입력과 정확히 같은 식별자를 가진 것만** 후보로 인정한다(공백 제거,
 * 대소문자 무시 — 이메일·로그인아이디는 실무에서 대소문자를 구별하지 않는다).
 * 부분일치만 있으면 `not_found` 다 — 「못 찾음」이 「엉뚱한 사람에게 발급」보다 낫다.
 */

export type LookupOutcome<T> =
  | { kind: 'resolved'; match: T }
  | { kind: 'not_found' }
  | { kind: 'ambiguous' };

const normalize = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

export function classifyLookupMatches<T>(
  input: string,
  matches: T[],
  /** 이 후보가 「정확히 그 사람」인지 판정할 때 볼 식별자들(로그인아이디·이메일 등). */
  identifiersOf: (match: T) => (string | null | undefined)[],
): LookupOutcome<T> {
  if (matches.length === 0) return { kind: 'not_found' };

  const wanted = normalize(input);
  if (wanted === '') return { kind: 'not_found' };

  const exact = matches.filter((m) => identifiersOf(m).some((id) => normalize(id) === wanted));

  // 부분일치뿐이다 — 관리자가 의도한 사람이 아닐 수 있으므로 발급하지 않는다.
  if (exact.length === 0) return { kind: 'not_found' };
  // 같은 식별자를 여러 계정이 가진 경우. 사람이 골라야 한다.
  if (exact.length > 1) return { kind: 'ambiguous' };
  return { kind: 'resolved', match: exact[0] };
}
