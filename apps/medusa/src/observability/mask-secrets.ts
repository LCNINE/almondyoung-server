/**
 * URL 형태 접속 문자열의 자격증명 구간에서 비밀번호만 치환한다.
 *
 * 스킴·사용자명·호스트·포트·경로는 보존한다 — 어느 호스트의 어느 논리 DB 에 붙다
 * 실패했는지가 디버깅에 실제로 쓰이기 때문이다. 사용자명이 비어 있는 형태
 * (`redis://:pw@host`) 도 처리한다.
 *
 * 비밀번호에 포함된 `@` 도 전부 치환 대상에 포함된다 — 쿼리스트링의 `@` 같은
 * URL 본문 뒷부분의 문자는 보존한다. 대신 공백이 포함된 URL(RFC 위반)은 계약 밖이다.
 *
 * ### 과잉 마스킹 트레이드오프 (의도된 동작)
 *
 * 정규식은 `[^\s/?#]*` 로 탐욕적으로 매칭해 마지막 `@` 를 찾는다. 경로가 없는 URL 에서
 * 비밀번호 뒤에 구분자 없이 다른 `@` 가 오면, 그 `@` 까지 모두 `[REDACTED]` 로 덮는다.
 * 예: `postgresql://user:pass@localhost:5432,ops@127.0.0.1:1` → `postgresql://user:[REDACTED]@127.0.0.1:1`
 *
 * 이것을 좁혀서(`[^\s/?#,()]*` 같이) 막으면 `,` `(` `)` 가 든 비밀번호에서 다시 샌다
 * (RFC 3986 상 이 문자들은 userinfo 에 인코딩 없이 들어갈 수 있다). 보안에서는 under-mask(유출)
 * 보다 over-mask(정보 손실)를 택한다.
 *
 * 실제 영향은 없다 — 이 저장소의 접속 문자열(`deployments/lcnine/services/infra/shared.ts` 의
 * `dbUrl()`)은 항상 경로(예: `/medusa`)를 포함하고, `/` 가 탐욕적 매칭을 끊는다. valkey
 * URL(`deployments/lcnine/services/infra/services.ts` 의 `redis://localhost:6379/0`,
 * `/1`)도 경로가 있다 — 애초에 비밀번호도 없어 이 트레이드오프와 무관하지만, "무경로 URL"
 * 이라는 예외조차 이 저장소엔 없다는 뜻이다.
 *
 * 이미 치환된 문자열에 다시 적용해도 결과가 같다 (멱등).
 */
const CONNECTION_STRING_CREDENTIALS = /:\/\/([^:/?#\s@]*):([^\s/?#]*)@/g;

export function maskConnectionStrings(text: string): string {
  return text.replace(CONNECTION_STRING_CREDENTIALS, '://$1:[REDACTED]@');
}
