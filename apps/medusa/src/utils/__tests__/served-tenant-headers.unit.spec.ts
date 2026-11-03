import { refuseForeignTenantToken, servedTenantHeaders } from '../served-tenant-headers';

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

describe('refuseForeignTenantToken', () => {
  const original = process.env.SERVED_TENANT_ID;
  afterEach(() => {
    if (original === undefined) delete process.env.SERVED_TENANT_ID;
    else process.env.SERVED_TENANT_ID = original;
  });

  it('토큰 테넌트가 T 면 통과한다', () => {
    process.env.SERVED_TENANT_ID = '1';
    expect(refuseForeignTenantToken('1')).toBeUndefined();
  });

  it('다른 테넌트의 토큰은 거절한다', () => {
    process.env.SERVED_TENANT_ID = '1';
    expect(refuseForeignTenantToken('2')).toMatch(/tenant/);
  });

  it('tenant 클레임이 없거나 문자열이 아니면 거절한다', () => {
    process.env.SERVED_TENANT_ID = '1';
    expect(refuseForeignTenantToken(undefined)).toMatch(/tenant/);
    expect(refuseForeignTenantToken(1)).toMatch(/tenant/);
    expect(refuseForeignTenantToken('')).toMatch(/tenant/);
  });

  it('T 가 없으면 거절한다 — 기본 테넌트로 통과시키지 않는다', () => {
    delete process.env.SERVED_TENANT_ID;
    expect(refuseForeignTenantToken('1')).toMatch(/SERVED_TENANT_ID/);
    process.env.SERVED_TENANT_ID = '  ';
    expect(refuseForeignTenantToken('1')).toMatch(/SERVED_TENANT_ID/);
  });
});
