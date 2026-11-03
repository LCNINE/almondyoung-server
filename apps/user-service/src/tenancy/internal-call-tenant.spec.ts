import { parseTenantList } from '@app/tenancy';
import { internalCallTenant } from './internal-call-tenant';

const tenants = parseTenantList(
  JSON.stringify([
    { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'bucket-one', privateBucket: 'bucket-one' },
    { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'bucket-two-pub', privateBucket: 'bucket-two-priv' },
  ]),
);
const withHeader = (value: unknown) => ({ headers: { 'x-tenant-id': value } });

describe('내부 키 호출의 테넌트', () => {
  it('호출자가 실은 목록 안의 테넌트를 쓴다', () => {
    expect(internalCallTenant(withHeader('2'), tenants)).toBe('2');
    expect(internalCallTenant(withHeader(' 1 '), tenants)).toBe('1');
  });

  // 기본 테넌트는 없다 — 헤더가 없다고 테넌트 1 로 찾으면 다른 테넌트의 문자 답장이 테넌트 1 회원에게 닿는다.
  it('테넌트를 싣지 않은 호출은 거절한다', () => {
    expect(() => internalCallTenant({ headers: {} }, tenants)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => internalCallTenant(withHeader(''), tenants)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => internalCallTenant(withHeader(['1', '2']), tenants)).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('목록에 없는 테넌트는 거절한다', () => {
    expect(() => internalCallTenant(withHeader('9'), tenants)).toThrow(expect.objectContaining({ status: 403 }));
  });
});
