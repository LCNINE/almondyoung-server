/**
 * admin-web 서버가 쥔 자격증명(Medusa 공유 Admin secret, channel-adapter 내부 키 …)으로 업스트림을 부르는 라우트의
 * 테넌트 판정. 그 업스트림은 한 테넌트 T 만 섬기고 사람 토큰을 보지 않으므로, 공유 서비스 문(`ServedTenantGate`)이
 * 닿지 않는다 — 여기서 막지 않으면 테넌트 2 직원이 상품 조회 권한만으로 T 의 상품·주문을 본다.
 * 판정 규칙은 `libs/authorization/src/services/served-tenant-gate.ts` 와 같다.
 */

/** `@app/tenancy` 의 `TENANT_HEADER` 사본 — admin-web 은 루트 libs 를 못 가져온다(permission-wiring.spec 이 대조한다). */
export const TENANT_HEADER = 'x-tenant-id';

export type TenantGateMode = 'warn' | 'reject';

export interface ServerCredentialTenantConfig {
  /** 서버 자격증명이 닿는 업스트림이 섬기는 테넌트 T. */
  readonly tenantId: string;
  readonly gateMode: TenantGateMode;
}

export type ServerCredentialTenantDecision =
  /** untenanted = 테넌트 없는 토큰을 warn 에서 통과시켰다(셈 대상). 업스트림에는 언제나 T 를 싣는다. */
  | { readonly admit: true; readonly tenantId: string; readonly untenanted: boolean }
  | { readonly admit: false; readonly status: 403; readonly reason: 'other-tenant' | 'untenanted' }
  | { readonly admit: false; readonly status: 503; readonly reason: 'not-configured' };

/** 기본값이 없다 — 하나라도 빠지거나 모르는 값이면 null(라우트는 닫는다). */
export function readServerCredentialTenantConfig(
  env: Readonly<Record<string, string | undefined>>
): ServerCredentialTenantConfig | null {
  const tenantId = env.SERVER_CREDENTIAL_TENANT_ID?.trim();
  const gateMode = env.TENANT_GATE_MODE?.trim();
  if (!tenantId || (gateMode !== 'warn' && gateMode !== 'reject')) return null;
  return { tenantId, gateMode };
}

/** 남의 테넌트는 두 모드 모두 403, 테넌트 없는 토큰은 warn 이면 통과 + 셈·reject 면 403. */
export function decideServerCredentialTenant(
  tokenTenant: string | undefined,
  config: ServerCredentialTenantConfig | null
): ServerCredentialTenantDecision {
  if (!config) return { admit: false, status: 503, reason: 'not-configured' };
  if (tokenTenant === config.tenantId) return { admit: true, tenantId: config.tenantId, untenanted: false };
  if (tokenTenant !== undefined) return { admit: false, status: 403, reason: 'other-tenant' };
  if (config.gateMode === 'reject') return { admit: false, status: 403, reason: 'untenanted' };
  return { admit: true, tenantId: config.tenantId, untenanted: true };
}
