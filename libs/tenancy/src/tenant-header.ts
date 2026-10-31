/**
 * 서비스 간 호출의 테넌트 헤더. 내부 키처럼 여러 테넌트를 섬기는 호출자도 쥐는 자격증명은 그것만으로 테넌트를
 * 말하지 못하므로, 받는 쪽 문이 이 헤더로 테넌트를 정한다. 사람 토큰이 있으면 토큰이 이긴다.
 */
export const TENANT_HEADER = 'x-tenant-id';

/** 요청의 테넌트 헤더. 빈 값·여러 값은 «없음»이다 — 둘 중 하나를 고르면 호출자가 문을 고르게 된다. */
export function tenantHeaderOf(request: unknown): string | undefined {
  if (typeof request !== 'object' || request === null || !('headers' in request)) return undefined;
  const headers: unknown = request.headers;
  if (typeof headers !== 'object' || headers === null) return undefined;
  const value: unknown = Reflect.get(headers, TENANT_HEADER);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** 맥락의 테넌트, 없으면 앱의 T. 둘 다 없으면 헤더를 싣지 않는다 — 기본 테넌트로 채우지 않는다. */
export function outboundTenantHeaders(
  contextTenant: string | undefined,
  servedTenantId: string | undefined,
): Record<string, string> {
  const tenant = contextTenant ?? servedTenantId;
  return tenant ? { [TENANT_HEADER]: tenant } : {};
}

/** 스펙에서 `OutboundTenant` 대신 넘긴다 — 맥락 없이 앱의 T 만 있는 상태와 같다. */
export function outboundTenantForTesting(servedTenantId: string | undefined = '1'): {
  headers(): Record<string, string>;
  tenantId(): string | undefined;
} {
  return { headers: () => outboundTenantHeaders(undefined, servedTenantId), tenantId: () => servedTenantId };
}
