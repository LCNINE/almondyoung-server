/**
 * 발급 요청 하나의 결과를 닫힌 어휘로 접는다 (PR-2 결정 3).
 *
 * 옛 워크플로는 `{created[], duplicated[], exhausted}` 날것을 돌려줬고, 라우트 넷이 그것을
 * 제각각 읽었다 — 고객축·쿠폰축은 「exhausted 면 max_claims_exceeded, created 있으면 issued,
 * 둘 다 아니면 already_issued」, 자동발급은 「duplicated 먼저」, 클레임은 「exhausted 만 409」.
 * 재해석이 넷이면 갈린다. 여기서 한 번 접고 라우트는 표만 본다.
 *
 * - `issued`         created ≥ 1, 상한 안 닿음
 * - `partial`        created ≥ 1 인데 도중에 상한 — 라우트는 issued **와** max_claims_exceeded 둘 다
 * - `exhausted`      created 0, 상한
 * - `already_issued` created 0, 상한 아님 = 전부 duplicate(같은 submit 의 재시도)
 * - `error` 는 여기서 나오지 않는다 — 스텝이 요청 단위 예외를 잡을 때 직접 붙인다.
 */
export type IssueGrantVerdict = 'issued' | 'partial' | 'already_issued' | 'exhausted' | 'error';

export function verdictOf(created: number, exhausted: boolean): IssueGrantVerdict {
  if (created > 0) return exhausted ? 'partial' : 'issued';
  return exhausted ? 'exhausted' : 'already_issued';
}
