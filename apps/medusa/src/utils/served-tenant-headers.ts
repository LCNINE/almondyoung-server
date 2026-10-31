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
