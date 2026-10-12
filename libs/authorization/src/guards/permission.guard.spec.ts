import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { PermissionDecider, Verdict } from '../services/permission-decider';
import { PermissionRuntimeOptions } from '../services/permission-runtime.options';
import { RouteRequirementResolver } from '../services/route-requirement.resolver';
import { PermissionGuard } from './permission.guard';

const options = (enforce: boolean): PermissionRuntimeOptions => ({
  service: 'core',
  enforce,
  refreshIntervalMs: 30_000,
  retryBaseMs: 1_000,
  summaryIntervalMs: 300_000,
});

class Probe {
  handle(): void {}
}

const context = (type: 'http' | 'rpc' = 'http'): ExecutionContextHost => {
  const host = new ExecutionContextHost([{ user: { roles: ['intern'] } }, {}], Probe, Probe.prototype.handle);
  host.setType(type);
  return host;
};

const guardWith = (enforce: boolean, verdict: Verdict) => {
  const resolver: Pick<RouteRequirementResolver, 'resolve'> = {
    resolve: () => ({ requirement: { kind: 'permission', anyOf: ['order.order.write'] }, path: '/orders' }),
  };
  const decide = jest.fn(() => verdict);
  return { guard: new PermissionGuard(resolver, { decide }, options(enforce)), decide };
};

describe('PermissionGuard', () => {
  it('does nothing while enforcement is off', () => {
    const { guard, decide } = guardWith(false, { allowed: false, reason: 'missing_permission' });
    expect(guard.canActivate(context())).toBe(true);
    expect(decide).not.toHaveBeenCalled();
  });

  it('ignores non-http contexts', () => {
    const { guard } = guardWith(true, { allowed: false, reason: 'missing_permission' });
    expect(guard.canActivate(context('rpc'))).toBe(true);
  });

  it('maps each deny reason to its status once enforced', () => {
    const run = (verdict: Verdict) => () => guardWith(true, verdict).guard.canActivate(context());
    expect(run({ allowed: false, reason: 'missing_permission' })).toThrow(ForbiddenException);
    expect(run({ allowed: false, reason: 'unclassified' })).toThrow(ForbiddenException);
    expect(run({ allowed: false, reason: 'unauthenticated' })).toThrow(UnauthorizedException);
    expect(run({ allowed: false, reason: 'unavailable' })).toThrow(ServiceUnavailableException);
  });

  it('names the required permission in the 403 body', () => {
    let body: unknown;
    try {
      guardWith(true, { allowed: false, reason: 'missing_permission' }).guard.canActivate(context());
    } catch (error) {
      body = error instanceof ForbiddenException ? error.getResponse() : undefined;
    }
    expect(body).toMatchObject({ requiredPermissions: ['order.order.write'] });
  });

  it('allows once enforced and granted', () => {
    expect(guardWith(true, { allowed: true }).guard.canActivate(context())).toBe(true);
  });
});
