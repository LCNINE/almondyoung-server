import { TenancyConfigError } from './tenancy-config.error';
import { parseTenantGateMode, requireServedTenant } from './tenancy-settings';
import { parseTenantList } from './tenant-list';

const tenants = parseTenantList(
  JSON.stringify([
    {
      id: '1',
      slug: 'almondyoung',
      coreDb: 'core',
      publicBucket: 'almondyoung-demo',
      privateBucket: 'almondyoung-demo',
    },
  ]),
);

describe('requireServedTenant — 앱 설정 T 가 목록에 있나', () => {
  it('목록에 있는 T 면 그 항목을 돌려준다', () => {
    expect(requireServedTenant(tenants, '1')).toEqual(expect.objectContaining({ id: '1', coreDb: 'core' }));
  });

  it('목록에 없는 T 는 TenancyConfigError — 그대로 두면 모든 메시지를 조용히 건너뛰는 앱이 된다', () => {
    expect(() => requireServedTenant(tenants, '2')).toThrow(TenancyConfigError);
    expect(() => requireServedTenant(tenants, '2')).toThrow(/SERVED_TENANT_ID «2» 가 테넌트 목록에 없다/);
  });

  it('T 가 비어 있으면 TenancyConfigError — 기본 테넌트는 없다', () => {
    expect(() => requireServedTenant(tenants, undefined)).toThrow(/SERVED_TENANT_ID 가 없다/);
    expect(() => requireServedTenant(tenants, ' ')).toThrow(/SERVED_TENANT_ID 가 없다/);
  });
});

describe('parseTenantGateMode — 전환 모드 하나', () => {
  it('warn(① 없으면 경고 + 센다)·reject(② 없으면 거절)를 읽는다', () => {
    expect(parseTenantGateMode('warn')).toBe('warn');
    expect(parseTenantGateMode('reject')).toBe('reject');
  });

  it('값이 없으면 TenancyConfigError — 기본값이 없다', () => {
    expect(() => parseTenantGateMode(undefined)).toThrow(TenancyConfigError);
    expect(() => parseTenantGateMode('')).toThrow(/TENANT_GATE_MODE 가 없다/);
  });

  it('모르는 값은 TenancyConfigError — 철자 틀린 값이 조용히 한쪽으로 떨어지지 않게', () => {
    expect(() => parseTenantGateMode('Reject')).toThrow(/warn 또는 reject/);
    expect(() => parseTenantGateMode('enforce')).toThrow(/warn 또는 reject/);
  });
});
