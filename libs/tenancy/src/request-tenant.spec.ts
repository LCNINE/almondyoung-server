import { ForbiddenException } from '@nestjs/common';
import { parseTenantList } from './tenant-list';
import { resolveRequestTenant, type RequestTenantInput } from './request-tenant';

const tenants = parseTenantList(
  JSON.stringify([
    { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'b-one', privateBucket: 'b-one' },
    { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'b-two-pub', privateBucket: 'b-two-priv' },
  ]),
);

const resolve = (input: Partial<RequestTenantInput>) =>
  resolveRequestTenant({ entry: 'token', user: undefined, header: undefined, ...input }, tenants);

describe('resolveRequestTenant — core 요청의 테넌트 맥락', () => {
  describe('사람 토큰', () => {
    it('토큰의 tenant 가 맥락이다', () => {
      expect(resolve({ user: { tenant: '2' } })).toEqual({ tenant: '2' });
    });

    it('토큰과 헤더가 같으면 통과, 다르면 거절한다 — 헤더는 토큰 테넌트를 바꾸지 못한다', () => {
      expect(resolve({ user: { tenant: '2' }, header: '2' })).toEqual({ tenant: '2' });
      expect(() => resolve({ user: { tenant: '2' }, header: '1' })).toThrow(ForbiddenException);
    });

    it('tenant 클레임이 없는 토큰은 모르는 테넌트다 — 헤더가 대신하지 못한다', () => {
      expect(resolve({ user: { roles: ['admin'] } })).toEqual({ untenanted: 'token' });
      expect(resolve({ user: { roles: ['admin'] }, header: '1' })).toEqual({ untenanted: 'token' });
    });
  });

  describe('내부 키 입구(service)', () => {
    it('헤더가 맥락이다', () => {
      expect(resolve({ entry: 'service', header: '2' })).toEqual({ tenant: '2' });
    });

    it('헤더가 없으면 모르는 테넌트다', () => {
      expect(resolve({ entry: 'service' })).toEqual({ untenanted: 'service' });
    });

    it('토큰이 함께 오면 토큰이 이기고, 헤더와 다르면 거절한다', () => {
      expect(resolve({ entry: 'service', user: { tenant: '1' }, header: '1' })).toEqual({ tenant: '1' });
      expect(() => resolve({ entry: 'service', user: { tenant: '1' }, header: '2' })).toThrow(ForbiddenException);
    });
  });

  describe('@Public', () => {
    it('호출자의 헤더가 맥락이다', () => {
      expect(resolve({ entry: 'public', header: '1' })).toEqual({ tenant: '1' });
    });

    it('사람 토큰이 오면 토큰 테넌트가 맥락이다(admin-web·ai 는 헤더를 안 싣는다)', () => {
      expect(resolve({ entry: 'public', user: { tenant: '2' } })).toEqual({ tenant: '2' });
      expect(() => resolve({ entry: 'public', user: { tenant: '2' }, header: '1' })).toThrow(ForbiddenException);
    });

    it('클레임 없는 토큰(쇼핑몰의 옛 내부 세션 토큰)은 공개 콘텐츠의 DB 를 정하지 못하니 헤더를 쓴다', () => {
      expect(resolve({ entry: 'public', user: { aud: 'user-service-internal' }, header: '1' })).toEqual({
        tenant: '1',
        claimlessToken: true,
      });
    });

    it('헤더도 토큰 테넌트도 없으면 모르는 테넌트다', () => {
      expect(resolve({ entry: 'public' })).toEqual({ untenanted: 'public' });
      expect(resolve({ entry: 'public', user: null })).toEqual({ untenanted: 'public' });
    });
  });

  it('목록에 없는 테넌트는 어느 입구든 거절한다', () => {
    expect(() => resolve({ user: { tenant: '9' } })).toThrow(ForbiddenException);
    expect(() => resolve({ entry: 'service', header: '9' })).toThrow(ForbiddenException);
    expect(() => resolve({ entry: 'public', header: '9' })).toThrow(ForbiddenException);
  });
});
