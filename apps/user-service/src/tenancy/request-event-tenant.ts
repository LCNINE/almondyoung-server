import { tokenTenantOf, type RequestEntry, type TenantList } from '@app/tenancy';

export interface RequestEventTenantInput {
  readonly entry: RequestEntry;
  /** 검증된 토큰의 사용자(`request.user`). */
  readonly user: object | null | undefined;
  /** `x-tenant-id` 헤더. */
  readonly header: string | undefined;
  /** `x-internal-secret` 이 `OAUTH_INTERNAL_SECRET` 과 맞는다 — auth-web 서버가 «이 요청은 그 테넌트 화면에서 왔다»고 보증한다. */
  readonly vouched: boolean;
}

/**
 * user-service 요청에서 낸 테넌트 이벤트의 테넌트 = 그 일이 일어난 화면의 테넌트. 못 정하면 undefined(봉투 찍기가 T 로 떨어진다).
 *
 * - 사람 토큰 라우트: auth-web 이 보증한 헤더가 먼저다. 내부 세션 토큰은 로그인한 도메인과 무관하게 `tenant: T` 라(29), 테넌트 auth-web 의
 *   첫 로그인 비밀번호 변경은 토큰만으로는 테넌트 2 를 알 수 없다. 화면 테넌트는 auth-web 이 Host → `tenant_domains` 로 정한다.
 *   그다음 토큰의 `tenant`. 보증 없는 헤더는 무시한다 — 헤더 하나로 테넌트 1 고객의 보안 메일을 끌 수 없게.
 * - 내부 키 라우트: 호출자의 테넌트 헤더.
 * - @Public·클레임 없는 토큰·목록 밖 값: 맥락 없음(보증된 헤더가 와도).
 *
 * core 의 `resolveRequestTenant` 와 달리 거절하지 않는다 — 입구 판정은 인증 가드·`ServedTenantGuard` 가 이미 하고,
 * 이 판정은 이벤트 봉투의 테넌트만 정한다.
 */
export function requestEventTenant(input: RequestEventTenantInput, tenants: TenantList): string | undefined {
  const listed = (id: string | undefined) => (id !== undefined && tenants.find(id) ? id : undefined);

  if (input.entry === 'token') {
    const vouched = input.vouched ? listed(input.header) : undefined;
    return vouched ?? listed(tokenTenantOf(input.user));
  }
  if (input.entry === 'service') return listed(input.header);
  return undefined;
}
