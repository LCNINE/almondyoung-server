/**
 * 테넌트 설정의 env 이름은 여기 한 곳에만 있다. SST·로컬 E2E 템플릿·preflight 가 같은 이름을 쓴다.
 * - TENANT_LIST      : 테넌트 목록 Secret(JSON). 모든 문이 같은 값을 읽는다.
 * - TENANT_GATE_MODE : 전환 모드. 문마다 따로 두지 않는다 — 배포 ①·② 가 이 값 하나로 갈린다.
 * - SERVED_TENANT_ID : 앱 설정 T(«이 앱이 섬기는 테넌트»). T 만 섬기는 앱만 둔다.
 */
export const TENANCY_ENV = {
  tenantList: 'TENANT_LIST',
  gateMode: 'TENANT_GATE_MODE',
  servedTenantId: 'SERVED_TENANT_ID',
} as const;
