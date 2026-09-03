/**
 * 발급 다이얼로그의 회원 조회 결과 판정 — **순수 함수**.
 *
 * `.tsx` 안에 있으면 admin-web 의 jest transform(`^.+\.(t|j)s$`) 밖이라 테스트가 실행조차
 * 되지 않는다(#488 Task 12 리뷰 Important #2). 비동기 API 호출(user-service 조회)은
 * 다이얼로그에 남기고, 판정만 여기로 뺀다.
 *
 * 🔴 **조회는 부분일치(ilike)다.** user-service 의 `q` 는 username·nickname·email·loginId·
 * 전화번호를 전부 `ilike '%q%'` 로 훑는다. 그래서 「결과가 1건이면 그 사람」은 틀렸다 —
 * 관리자가 오타를 냈을 때 유일한 히트가 `bobby` 면 옛 판정은 그것을 「확인됨」으로 표시하고
 * **남의 계정에 쿠폰을 발급했다.** 그래서 히트 중 **입력과 정확히 같은 식별자를 가진 것만**
 * 후보로 인정한다. 부분일치만 있으면 `not_found` 다 — 「못 찾음」이 「엉뚱한 사람에게 발급」
 * 보다 낫다.
 *
 * 🔴 **정확일치로 볼 식별자는 서버가 검색하는 축과 같아야 한다.** loginId·email 둘만 보면
 * 전화번호나 이름으로 조회한 관리자는 서버가 정확히 한 명을 찾아 줬는데도 「회원을 찾을 수
 * 없습니다」를 받는다 — 있는 고객이 발급 다이얼로그에서 통째로 사라진다.
 */

export type LookupOutcome<T> =
  | { kind: 'resolved'; match: T }
  | { kind: 'not_found' }
  | { kind: 'ambiguous' };

const normalizeText = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

/**
 * 전화번호 비교용 정규화. 하이픈·공백을 버리고 국가번호를 국내 표기로 접는다 —
 * 저장값이 `+8210…` 인데 관리자는 `010-…` 로 입력하는 것이 보통이다(서버도 같은 폴딩을 한다).
 */
const normalizePhone = (v: string | null | undefined): string => {
  const digits = (v ?? '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  return digits.startsWith('82') ? `0${digits.slice(2)}` : digits;
};

/** 전화번호로 «볼 만한» 입력인가. 짧은 숫자가 우연히 번호와 맞아떨어지는 것을 막는다. */
const looksLikePhone = (input: string): boolean => normalizePhone(input).length >= 9;

export function classifyLookupMatches<T>(
  input: string,
  matches: T[],
  /** 문자열로 정확 비교할 식별자들 — loginId·email·username·nickname. */
  identifiersOf: (match: T) => (string | null | undefined)[],
  /** 전화번호. 문자열 비교가 아니라 숫자 정규화로 비교하므로 따로 받는다. */
  phoneOf?: (match: T) => string | null | undefined,
): LookupOutcome<T> {
  if (matches.length === 0) return { kind: 'not_found' };

  const wantedText = normalizeText(input);
  if (wantedText === '') return { kind: 'not_found' };
  const wantedPhone = looksLikePhone(input) ? normalizePhone(input) : null;

  const exact = matches.filter((m) => {
    if (identifiersOf(m).some((id) => normalizeText(id) === wantedText)) return true;
    if (wantedPhone && phoneOf) return normalizePhone(phoneOf(m)) === wantedPhone;
    return false;
  });

  // 부분일치뿐이다 — 관리자가 의도한 사람이 아닐 수 있으므로 발급하지 않는다.
  if (exact.length === 0) return { kind: 'not_found' };
  // 같은 식별자를 여러 계정이 가진 경우. 사람이 골라야 한다.
  if (exact.length > 1) return { kind: 'ambiguous' };
  return { kind: 'resolved', match: exact[0] };
}
