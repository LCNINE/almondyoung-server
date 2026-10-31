import { servedTenantHeaders } from '../served-tenant-headers';

describe('servedTenantHeaders', () => {
  const original = process.env.SERVED_TENANT_ID;
  afterEach(() => {
    if (original === undefined) delete process.env.SERVED_TENANT_ID;
    else process.env.SERVED_TENANT_ID = original;
  });

  it('앱 설정 T 를 테넌트 헤더로 싣는다', () => {
    process.env.SERVED_TENANT_ID = '1';
    expect(servedTenantHeaders()).toEqual({ 'x-tenant-id': '1' });
  });

  it('T 가 없거나 비었으면 헤더를 싣지 않는다 — 기본 테넌트로 채우지 않는다', () => {
    delete process.env.SERVED_TENANT_ID;
    expect(servedTenantHeaders()).toEqual({});
    process.env.SERVED_TENANT_ID = '  ';
    expect(servedTenantHeaders()).toEqual({});
  });
});
