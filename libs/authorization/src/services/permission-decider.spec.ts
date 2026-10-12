import { PermissionCache } from './permission-cache';
import { PermissionDecider } from './permission-decider';
import type { RouteRequirement } from './route-requirement.resolver';

const cacheWith = (byRole: Record<string, string[]> | null): Pick<PermissionCache, 'permissionsFor'> => ({
  permissionsFor: (roles) => (byRole === null ? null : new Set(roles.flatMap((role) => byRole[role] ?? []))),
});

describe('PermissionDecider', () => {
  const ready = new PermissionDecider(cacheWith({ admin: ['order.order.read'], intern: [] }));
  const order: RouteRequirement = { kind: 'permission', anyOf: ['order.order.read'] };

  it('allows open routes without looking at roles', () => {
    expect(ready.decide({ kind: 'open' }, undefined)).toEqual({ allowed: true });
  });

  it('denies an unclassified route even for master', () => {
    expect(ready.decide({ kind: 'unclassified' }, ['master'])).toEqual({ allowed: false, reason: 'unclassified' });
  });

  it('separates an unauthenticated caller from a caller without the permission', () => {
    expect(ready.decide(order, undefined)).toEqual({ allowed: false, reason: 'unauthenticated' });
    expect(ready.decide(order, ['intern'])).toEqual({ allowed: false, reason: 'missing_permission' });
    expect(ready.decide(order, [])).toEqual({ allowed: false, reason: 'missing_permission' });
  });

  it('allows when any listed permission is held', () => {
    expect(ready.decide({ kind: 'permission', anyOf: ['x.y.write', 'order.order.read'] }, ['admin'])).toEqual({
      allowed: true,
    });
  });

  it('reports unavailable instead of deny when there is no copy yet', () => {
    expect(new PermissionDecider(cacheWith(null)).decide(order, ['admin'])).toEqual({
      allowed: false,
      reason: 'unavailable',
    });
  });
});
