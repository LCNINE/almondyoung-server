import { TenancyConfigError } from './tenancy-config.error';
import { parseTenantList, tenantOfCoreDatabase } from './tenant-list';

const tenants = parseTenantList(
  JSON.stringify([
    { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'b-one', privateBucket: 'b-one' },
    { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'b-two-pub', privateBucket: 'b-two-priv' },
  ]),
);

describe('tenantOfCoreDatabase — core 는 접속한 DB 가 곧 테넌트다', () => {
  it('접속 주소의 DB 이름이 coreDb 인 테넌트를 고른다', () => {
    expect(tenantOfCoreDatabase(tenants, 'postgresql://u:p@db:5432/core_two?sslmode=require').id).toBe('2');
    expect(tenantOfCoreDatabase(tenants, 'postgresql://u:p@db:5432/core').id).toBe('1');
  });

  it('어느 coreDb 도 아니면 거절한다 — 아무 테넌트로나 내보내지 않는다', () => {
    expect(() => tenantOfCoreDatabase(tenants, 'postgresql://u:p@db:5432/wallet')).toThrow(TenancyConfigError);
  });

  it('주소가 없거나 DB 이름이 없으면 거절한다', () => {
    expect(() => tenantOfCoreDatabase(tenants, undefined)).toThrow(TenancyConfigError);
    expect(() => tenantOfCoreDatabase(tenants, 'postgresql://u:p@db:5432')).toThrow(TenancyConfigError);
    expect(() => tenantOfCoreDatabase(tenants, 'not a url')).toThrow(TenancyConfigError);
  });

  it('거절 메시지에 DB 이름을 싣지 않는다(비공개 값)', () => {
    expect(() => tenantOfCoreDatabase(tenants, 'postgresql://u:p@db:5432/secretdb')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secretdb') }),
    );
  });
});
