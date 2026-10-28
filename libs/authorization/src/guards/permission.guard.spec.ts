import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { getPermissionDecision } from '../services/permission-decision';
import { PermissionDecider, Verdict } from '../services/permission-decider';
import { RouteRequirementResolver } from '../services/route-requirement.resolver';
import { PermissionGuard } from './permission.guard';

class Probe {
  handle(): void {}
}

const context = (type: 'http' | 'rpc' = 'http'): ExecutionContextHost => {
  const host = new ExecutionContextHost([{ user: { roles: ['intern'] } }, {}], Probe, Probe.prototype.handle);
  host.setType(type);
  return host;
};

const permissionRoute: Pick<RouteRequirementResolver, 'resolve'> = {
  resolve: () => ({ requirement: { kind: 'permission', anyOf: ['order.order.write'] }, path: '/orders' }),
};

const guardWith = (verdict: Verdict, granted: readonly string[] | null = ['order.order.write']) => {
  const decide = jest.fn(() => verdict);
  const grantedAmong = jest.fn((): readonly string[] | null => granted);
  return { guard: new PermissionGuard(permissionRoute, { decide, grantedAmong }), decide, grantedAmong };
};

const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('PermissionGuard', () => {
  it('refuses a caller without the permission and names it in the 403 body', () => {
    const error = thrownBy(() =>
      guardWith({ allowed: false, reason: 'missing_permission' }, null).guard.canActivate(context()),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error instanceof ForbiddenException ? error.getResponse() : undefined).toMatchObject({
      requiredPermissions: ['order.order.write'],
    });
  });

  it('cannot judge without a permission snapshot and says so', () => {
    const { guard } = guardWith({ allowed: false, reason: 'unavailable' }, null);
    const host = context();
    expect(() => guard.canActivate(host)).toThrow(ServiceUnavailableException);
    expect(getPermissionDecision(host.switchToHttp().getRequest(), 'order.order.write')).toBeUndefined();
  });

  it('refuses a route without an access policy', () => {
    expect(() => guardWith({ allowed: false, reason: 'unclassified' }).guard.canActivate(context())).toThrow(
      ForbiddenException,
    );
  });

  it('refuses an anonymous caller with 401', () => {
    expect(() => guardWith({ allowed: false, reason: 'unauthenticated' }).guard.canActivate(context())).toThrow(
      UnauthorizedException,
    );
  });

  it('allows a granted caller and stamps what it holds', () => {
    const { guard } = guardWith({ allowed: true });
    const host = context();
    expect(guard.canActivate(host)).toBe(true);
    expect(getPermissionDecision(host.switchToHttp().getRequest(), 'order.order.write')).toBeDefined();
  });

  it('does not stamp an open route', () => {
    const resolver: Pick<RouteRequirementResolver, 'resolve'> = {
      resolve: () => ({ requirement: { kind: 'open' }, path: '/x' }),
    };
    const decider: Pick<PermissionDecider, 'decide' | 'grantedAmong'> = {
      decide: jest.fn((): Verdict => ({ allowed: true })),
      grantedAmong: jest.fn(),
    };
    expect(new PermissionGuard(resolver, decider).canActivate(context())).toBe(true);
    expect(decider.grantedAmong).not.toHaveBeenCalled();
  });

  it('ignores non-http contexts', () => {
    const { guard, decide } = guardWith({ allowed: false, reason: 'missing_permission' });
    expect(guard.canActivate(context('rpc'))).toBe(true);
    expect(decide).not.toHaveBeenCalled();
  });
});
