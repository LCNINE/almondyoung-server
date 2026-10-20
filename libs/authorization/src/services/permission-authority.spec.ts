import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { InternalOnly } from '../decorators/internal-only.decorator';
import { KeyAuthRoute } from '../decorators/key-auth-route.decorator';
import { Public } from '../decorators/public.decorator';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { StoreRoute } from '../decorators/store-route.decorator';
import { PermissionAuthority } from './permission-authority';
import { PermissionRuntimeOptions } from './permission-runtime.options';
import { RouteRequirementResolver } from './route-requirement.resolver';

class Routes {
  @RequirePermission('order.order.read')
  permissionRoute(): void {}

  @StoreRoute()
  storeRoute(): void {}

  @KeyAuthRoute()
  keyRoute(): void {}

  @Public()
  publicRoute(): void {}

  @InternalOnly()
  internalRoute(): void {}

  bare(): void {}
}

const contextFor = (handler: keyof Routes, type: 'http' | 'rpc' = 'http'): ExecutionContext => {
  const context = new ExecutionContextHost([{}, {}], Routes, Routes.prototype[handler]);
  context.setType(type);
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

describe('PermissionAuthority', () => {
  it('decides permission routes once enforced', () => {
    expect(authority(true).enforced).toBe(true);
    expect(authority(true).decides(contextFor('permissionRoute'))).toBe(true);
  });

  it('never decides while the switch is off', () => {
    expect(authority(false).enforced).toBe(false);
    expect(authority(false).decides(contextFor('permissionRoute'))).toBe(false);
  });

  it.each(['storeRoute', 'keyRoute', 'publicRoute', 'internalRoute'] as const)(
    'keeps judging open routes once enforced (%s)',
    (handler) => {
      expect(authority(true).decides(contextFor(handler))).toBe(false);
    },
  );

  it('leaves unclassified routes to the guards', () => {
    expect(authority(true).decides(contextFor('bare'))).toBe(false);
  });

  it('ignores non-http contexts', () => {
    expect(authority(true).decides(contextFor('permissionRoute', 'rpc'))).toBe(false);
  });
});
