import { OUTBOX_TENANT_FROM_CONTEXT } from '@app/events';
import { parseTenantList, TenancyConfig } from '@app/tenancy';
import { coreOutboxTenant } from './core-outbox-tenant.module';

const tenants = parseTenantList(
  JSON.stringify([
    { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'bucket-one', privateBucket: 'bucket-one' },
    { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'bucket-two-pub', privateBucket: 'bucket-two-priv' },
  ]),
);

describe('core outbox 행의 테넌트', () => {
  it('① (warn) 단일 DB 면 접속한 DB 의 테넌트다', () => {
    expect(coreOutboxTenant(new TenancyConfig(tenants, 'warn'), 'postgres://u:p@h:5432/core')).toBe('1');
  });

  it('② (reject) 는 DB 를 테넌트 맥락이 고르므로 맥락을 따른다 — DATABASE_URL 의 DB 로 정하지 않는다', () => {
    expect(coreOutboxTenant(new TenancyConfig(tenants, 'reject'), 'postgres://u:p@h:5432/core')).toBe(
      OUTBOX_TENANT_FROM_CONTEXT,
    );
  });
});
