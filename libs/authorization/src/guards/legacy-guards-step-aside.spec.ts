import { CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { firstValueFrom, isObservable } from 'rxjs';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { RequireScopes } from '../decorators/require-scopes.decorator';
import { StoreRoute } from '../decorators/store-route.decorator';
import { PermissionAuthority } from '../services/permission-authority';
import { PermissionRuntimeOptions } from '../services/permission-runtime.options';
import { RouteRequirementResolver } from '../services/route-requirement.resolver';
import { AdminRealmGuard } from './admin-realm.guard';
import { MasterRoleGuard, RolesGuard } from './master-role.guard';
import { ScopeGuard } from './scope.guard';

/** 공용 JWT 전략이 남기는 실제 모양 — `id` 가 아니라 `userId`·`sub`. */
const intern = { userId: 'u-intern', sub: 'u-intern', roles: ['intern'] };

class Routes {
  @RequirePermission('order.order.read')
  @RequireScopes('admin:orders:read')
  permissionRoute(): void {}

  @RequirePermission('order.order.read')
  permissionOnlyRoute(): void {}

  @StoreRoute()
  @RequireScopes('user:read')
  storeRoute(): void {}
}

const contextFor = (handler: keyof Routes, user: unknown): ExecutionContext => {
  const context = new ExecutionContextHost([{ user }, {}], Routes, Routes.prototype[handler]);
  context.setType('http');
  return context;
};

const authority = (enforce: boolean) => {
  const options: PermissionRuntimeOptions = {
    service: 'core',
    enforce,
    refreshIntervalMs: 30_000,
    retryBaseMs: 1_000,
    summaryIntervalMs: 300_000,
  };
  return new PermissionAuthority(new RouteRequirementResolver(new Reflector()), options);
};

/** 옛 스코프 사본에 아무 매핑도 없다 — intern 은 옛 체계에서 아무것도 못 받는다. */
const noScopes = { getScopesByRoles: async () => new Set<string>() };

const guards: [string, (a?: PermissionAuthority) => CanActivate, keyof Routes][] = [
  ['AdminRealmGuard', (a) => new AdminRealmGuard(new Reflector(), a), 'permissionOnlyRoute'],
  ['ScopeGuard', (a) => new ScopeGuard(new Reflector(), noScopes, a), 'permissionRoute'],
  ['RolesGuard', (a) => new (RolesGuard('admin', 'master'))(a), 'permissionRoute'],
  ['MasterRoleGuard', (a) => new MasterRoleGuard(a), 'permissionRoute'],
];

const verdict = async (guard: CanActivate, context: ExecutionContext): Promise<boolean> => {
  try {
    const result = guard.canActivate(context);
    return isObservable(result) ? await firstValueFrom(result) : await result;
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
};

describe.each(guards)('%s', (_name, make, route) => {
  it('steps aside on a permission route once enforced', async () => {
    expect(await verdict(make(authority(true)), contextFor(route, intern))).toBe(true);
  });

  it('still denies the same request while the switch is off', async () => {
    expect(await verdict(make(authority(false)), contextFor(route, intern))).toBe(false);
  });

  it('behaves as before without an authority', async () => {
    expect(await verdict(make(), contextFor(route, intern))).toBe(false);
  });
});

describe('open routes once enforced', () => {
  it('ScopeGuard still judges a customer route', async () => {
    expect(await verdict(new ScopeGuard(new Reflector(), noScopes, authority(true)), contextFor('storeRoute', intern))).toBe(false);
  });

  it('RolesGuard still judges a customer route', async () => {
    const guard = new (RolesGuard('admin', 'master'))(authority(true));
    expect(await verdict(guard, contextFor('storeRoute', intern))).toBe(false);
  });
});
