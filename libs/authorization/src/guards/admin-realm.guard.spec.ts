import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRealmGuard } from './admin-realm.guard';
import { Public } from '../decorators/public.decorator';
import { OptionalAuth } from '../decorators/optional-auth.decorator';
import { StoreRoute } from '../decorators/store-route.decorator';
import { RequireScopes } from '../decorators/require-scopes.decorator';

/** 데코레이터를 실제 메서드에 적용해 Reflector 가 읽는 메타데이터를 그대로 재현한다. */
class Routes {
  bare(): void {}

  @Public()
  publicRoute(): void {}

  @OptionalAuth()
  optionalAuthRoute(): void {}

  @StoreRoute()
  storeRoute(): void {}

  @RequireScopes('inventory:warehouse:manage')
  scopedRoute(): void {}

  @RequireScopes()
  emptyScopesRoute(): void {}
}

function contextFor(handlerName: keyof Routes, user?: unknown, type: 'http' | 'rpc' = 'http'): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => Routes.prototype[handlerName],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('AdminRealmGuard', () => {
  let guard: AdminRealmGuard;

  beforeEach(() => {
    guard = new AdminRealmGuard(new Reflector());
  });

  describe('표시가 없는 라우트는 직원 전용이다', () => {
    it.each([['admin'], ['master']])('roles 에 %s 가 있으면 통과', (role) => {
      expect(guard.canActivate(contextFor('bare', { roles: [role] }))).toBe(true);
    });

    it.each([
      ['일반 고객', { roles: ['user'] }],
      ['멤버십 고객', { roles: ['membership', 'user'] }],
      ['역할 없음', { roles: [] }],
      ['roles 필드 자체가 없음', {}],
      ['roles 가 배열이 아님', { roles: 'admin' }],
      ['user 가 없음', undefined],
    ])('%s 은 403', (_label, user) => {
      expect(() => guard.canActivate(contextFor('bare', user))).toThrow(ForbiddenException);
    });

    // 회귀 방어: 이 프로젝트의 실제 권한상승 경로였다. 쇼핑몰 고객 토큰으로 관리자 쓰기 라우트를
    // 부를 수 있었고, 원인은 '표시 없는 라우트 = 통과' 라는 기본값이었다.
    it('물류 역할이라도 스코프 표시가 없는 라우트는 막는다', () => {
      expect(() => guard.canActivate(contextFor('bare', { roles: ['logistics_worker'] }))).toThrow(ForbiddenException);
    });
  });

  describe('정책이 명시된 라우트는 각자의 가드에 위임한다', () => {
    it.each([
      ['@Public', 'publicRoute' as const],
      ['@OptionalAuth', 'optionalAuthRoute' as const],
      ['@StoreRoute', 'storeRoute' as const],
      ['@RequireScopes', 'scopedRoute' as const],
    ])('%s 라우트는 직원이 아니어도 통과', (_label, handler) => {
      expect(guard.canActivate(contextFor(handler, { roles: ['user'] }))).toBe(true);
    });

    it('@RequireScopes 라우트는 user 가 아예 없어도 통과 (ScopeGuard 가 판단)', () => {
      expect(guard.canActivate(contextFor('scopedRoute', undefined))).toBe(true);
    });

    // 인자 없는 @RequireScopes() 는 ScopeGuard 도 통과시키므로 위임하면 아무도 안 막는다.
    it('빈 @RequireScopes() 는 위임하지 않고 직원 역할을 요구한다', () => {
      expect(() => guard.canActivate(contextFor('emptyScopesRoute', { roles: ['user'] }))).toThrow(ForbiddenException);
      expect(guard.canActivate(contextFor('emptyScopesRoute', { roles: ['admin'] }))).toBe(true);
    });
  });

  it('HTTP 가 아닌 컨텍스트(Kafka 등)는 관여하지 않는다', () => {
    expect(guard.canActivate(contextFor('bare', undefined, 'rpc'))).toBe(true);
  });
});
