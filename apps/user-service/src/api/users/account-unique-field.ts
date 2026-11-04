/**
 * 계정 insert(가입·관리자가 만드는 직원 계정·첫 master)가 걸린 DB unique 의 칸(이메일·아이디). 둘 다 테넌트 안에서만 unique 다(ADR-0056).
 * 중복 검사를 먼저 묻지만 같은 값의 동시 가입은 검사를 함께 통과하고 insert 에서 터진다 — 그 경합을 500 이 아닌 409 로 바꾸는 데 쓴다.
 * 제약 이름은 schema.ts 의 users 표와 같아야 한다(실 DB 통합 스펙 signup-within-tenant 가 실제 오류로 확인한다).
 */
export function accountUniqueFieldOf(error: unknown): 'email' | 'loginId' | null {
  // drizzle 이 postgres.js 오류를 cause 로 감싼다 — 타입이 공개돼 있지 않아 쓰는 두 칸만 좁혀 읽는다(business-licenses 와 같은 방식).
  const cause = (error as { cause?: { code?: string; constraint_name?: string } } | undefined)?.cause;
  if (cause?.code !== '23505') return null;
  if (cause.constraint_name === 'users_tenant_id_email_unique') return 'email';
  if (cause.constraint_name === 'users_tenant_id_login_id_unique') return 'loginId';
  return null;
}
