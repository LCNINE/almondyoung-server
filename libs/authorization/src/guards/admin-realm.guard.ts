import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { IS_STORE_ROUTE_KEY } from '../decorators/store-route.decorator';
import { REQUIRED_SCOPES_KEY } from '../decorators/require-scopes.decorator';

/** 직원으로 인정하는 역할. 세분화 전까지 모든 내부 직원은 최소 `admin` 을 갖는다. */
export const STAFF_ROLES: readonly string[] = ['admin', 'master'];

/**
 * 직원 영역(admin realm) 기본 차단 가드.
 *
 * 배경 — `ScopeGuard` 는 `@RequireScopes` 메타데이터가 **없으면 통과**시킨다. 그래서 스코프를
 * 붙이는 걸 잊은 라우트는 "인증만 하면 누구나" 가 된다. core 는 같은 앱에서 `/store/*`(고객)와
 * 관리자 API 를 함께 서빙하고 모든 서비스가 하나의 `AUTH_SECRET` 을 공유하므로, 쇼핑몰 고객
 * 토큰으로 관리자 엔드포인트를 부를 수 있었다. 이 가드가 그 기본값을 뒤집는다.
 *
 * 통과 조건 (하나라도 만족하면 이 가드는 판단을 위임한다):
 *   1. `@Public()` / `@OptionalAuth()`  — 인증 자체가 면제된 라우트.
 *   2. `@StoreRoute()`                  — 고객 라우트. 소유권 검사는 서비스 계층 책임.
 *   3. `@RequireScopes(...)`            — 스코프 정책이 이미 명시된 라우트. 판단은 `ScopeGuard`
 *                                         에 맡긴다. 물류 앱의 `logistics_worker` 처럼 직원이지만
 *                                         admin 이 아닌 역할이 여기 해당한다.
 *   4. 호출자가 `admin` 또는 `master`.
 *
 * 그 외에는 403. 즉 **새 라우트는 아무 표시도 없으면 직원 전용**이 기본값이다.
 *
 * 조건 3은 `@RequireScopes` 가 실제로 `ScopeGuard` 와 짝지어져 있을 때만 안전하다. 메타데이터만
 * 있고 가드가 없으면 아무것도 막지 못한다 — 이 짝이 유지되는지는 앱별 회귀 테스트가 검증한다
 * (core: `apps/core/src/platform/auth/scope-guard-binding.spec.ts`).
 */
@Injectable()
export class AdminRealmGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    const isFlagged = (key: string): boolean => this.reflector.getAllAndOverride<boolean>(key, targets) === true;

    if (isFlagged(IS_PUBLIC_KEY) || isFlagged(IS_OPTIONAL_AUTH_KEY)) return true;
    if (isFlagged(IS_STORE_ROUTE_KEY)) return true;

    const requiredScopes = this.reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES_KEY, targets);
    if (requiredScopes && requiredScopes.length > 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: { roles?: unknown } }>();
    const roles = request.user?.roles;

    if (Array.isArray(roles) && roles.some((role) => typeof role === 'string' && STAFF_ROLES.includes(role))) {
      return true;
    }

    throw new ForbiddenException('Staff role required');
  }
}
