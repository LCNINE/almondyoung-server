/**
 * 서비스 간 호출의 테넌트 헤더 이름. `@app/tenancy` 의 `TENANT_HEADER` 와 같은 값이다 — medusa 런타임은 루트 `libs/` 를
 * 가져오지 못해 사본을 두고, 둘이 갈리지 않는 것은 `scripts/security/permission-wiring.spec.ts` 가 지킨다.
 */
export const TENANT_HEADER = 'x-tenant-id';

/**
 * 내부 키로 다른 서비스(core·membership·ugc·search·notification)를 부를 때 싣는 테넌트 헤더.
 * 이 Medusa 는 한 테넌트만 섬기므로 그 테넌트는 앱 설정 T(`SERVED_TENANT_ID`)다. 내부 키는 여러 테넌트를 섬기는 호출자도
 * 쥐는 자격증명이라, 받는 쪽 문이 이 헤더로 테넌트를 정한다. T 가 없으면 싣지 않는다 — 기본 테넌트로 채우지 않는다.
 */
export function servedTenantHeaders(): Record<string, string> {
  const tenant = process.env.SERVED_TENANT_ID?.trim();
  return tenant ? { [TENANT_HEADER]: tenant } : {};
}

/**
 * user-service 토큰이 이 Medusa 가 섬기는 테넌트(T)의 것인지 본다. 아니면 거절 사유를, 맞으면 undefined 를 돌려준다.
 * 계정은 한 테넌트의 것이라(docs/adr/0056) 다른 테넌트에 같은 이메일 계정이 있을 수 있다 — 그 토큰을 들이면 SSO 콜백이
 * 이메일로 T 의 고객에 이어 붙이고, my-auth 는 그 테넌트의 `master` 를 이 Medusa 의 관리자로 만든다.
 * T 가 없으면 거절한다 — 기본 테넌트로 통과시키지 않는다.
 */
export function refuseForeignTenantToken(tokenTenant: unknown): string | undefined {
  const served = process.env.SERVED_TENANT_ID?.trim();
  if (!served) return 'SERVED_TENANT_ID is not set';
  if (typeof tokenTenant !== 'string' || tokenTenant !== served) {
    return 'token tenant is not served by this store';
  }
  return undefined;
}
