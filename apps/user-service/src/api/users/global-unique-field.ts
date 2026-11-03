/**
 * 계정 insert(가입·관리자가 만드는 직원 계정)가 걸린 DB unique 의 칸(이메일·아이디). 중복 검사는 테넌트 안에서만 묻지만 unique 는 contract 마이그(티켓 10)
 * 전까지 아직 전역이라, 다른 테넌트 계정이 가진 값이면 검사를 통과하고 insert 에서 터진다. 🔴 10 이 unique 를 (테넌트, …) 로
 * 넓히며 제약 이름이 바뀌면 여기도 바꾼다 — 그 뒤엔 동시 가입 경합에서만 오는 경로다.
 */
export function globalUniqueFieldOf(error: unknown): 'email' | 'loginId' | null {
  // drizzle 이 postgres.js 오류를 cause 로 감싼다 — 타입이 공개돼 있지 않아 쓰는 두 칸만 좁혀 읽는다(business-licenses 와 같은 방식).
  const cause = (error as { cause?: { code?: string; constraint_name?: string } } | undefined)?.cause;
  if (cause?.code !== '23505') return null;
  if (cause.constraint_name === 'users_email_unique') return 'email';
  if (cause.constraint_name === 'users_login_id_unique') return 'loginId';
  return null;
}
