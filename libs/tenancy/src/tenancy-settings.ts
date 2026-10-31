import { TENANCY_ENV } from './tenancy-env';
import { TenancyConfigError } from './tenancy-config.error';
import { TenantEntry, TenantList } from './tenant-list';

/**
 * 테넌트를 모르는 입력(테넌트 클레임 없는 토큰, 테넌트 없는 이벤트, 헤더 없는 내부 호출)을 문이 어떻게 다루나.
 * - warn   : 전환 배포 ① — 경고하고 세기만 한다. 아무것도 거절하지 않는다.
 * - reject : 전환 배포 ② — 거절한다.
 * 기본값은 없다. 값이 빠지면 «조용히 ①» 도 «조용히 ②» 도 아니라 기동 거부다.
 */
export type TenantGateMode = 'warn' | 'reject';

export function parseTenantGateMode(raw: string | undefined): TenantGateMode {
  const name = TENANCY_ENV.gateMode;

  if (!raw?.trim()) {
    throw new TenancyConfigError(name, [`${name} 가 없다 — 기본값은 없다 (warn 또는 reject)`]);
  }
  if (raw === 'warn' || raw === 'reject') return raw;

  throw new TenancyConfigError(name, [`${name} 는 warn 또는 reject 여야 한다`]);
}

/**
 * 앱 설정 T 를 목록과 대조한다. 없는 T 로 뜬 «T 만 섬기는» 앱은 모든 메시지를 건너뛰며 조용히 죽으므로
 * 부팅 때 부르고, 던지면 기동을 거부한다.
 */
export function requireServedTenant(tenants: TenantList, servedTenantId: string | undefined): TenantEntry {
  const name = TENANCY_ENV.servedTenantId;

  if (!servedTenantId?.trim()) {
    throw new TenancyConfigError(name, [`${name} 가 없다 — 기본 테넌트는 없다`]);
  }

  const entry = tenants.find(servedTenantId);
  if (!entry) {
    throw new TenancyConfigError(name, [`${name} «${servedTenantId}» 가 테넌트 목록에 없다`]);
  }

  return entry;
}
