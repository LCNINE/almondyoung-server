import { recordPermissionDecisions, RequireScopes, SCOPE_AUTHORIZATION_DECISION_BRAND, ScopeGuard } from '@app/authorization';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { FULFILLMENT_SCOPE } from './fulfillment-scopes';
import {
  adminForceDispatchDecisionFrom,
  forceDispatchDecisionFrom,
  forceDispatchDecisionKey,
  forceDispatchDecisionSource,
  isAdminForceDispatchDecision,
  isForceDispatchDecision,
} from './force-dispatch-authorization';

const decision = (scope: string, granted = true) => ({ scope, granted, [SCOPE_AUTHORIZATION_DECISION_BRAND]: true });

describe('isForceDispatchDecision', () => {
  it.each([
    ['관리자 강제출고', decision(FULFILLMENT_SCOPE.DISPATCH_FORCE), true],
    ['스테이션 강제출고', decision(FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE), true],
    ['다른 스코프', decision(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE), false],
    ['거절된 판정', decision(FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE, false), false],
    ['브랜드 없는 위조 객체', { scope: FULFILLMENT_SCOPE.DISPATCH_FORCE, granted: true }, false],
    ['판정 없음', undefined, false],
  ])('%s → %s', (_name, value, expected) => {
    expect(isForceDispatchDecision(value)).toBe(expected);
  });
});

class ForceRoutes {
  @RequireScopes(FULFILLMENT_SCOPE.DISPATCH_FORCE)
  admin(): void {}

  @RequireScopes(FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE)
  station(): void {}
}

/** 옛 판정 낙인은 ScopeGuard 를 실제로 통과시켜 만든다(위조 불가 낙인이라 손으로 못 만든다). */
const scopeStampedRequest = async (handler: keyof ForceRoutes) => {
  const request = { user: { userId: 'u-master', sub: 'u-master', roles: ['master'] } };
  const context = new ExecutionContextHost([request, {}], ForceRoutes, ForceRoutes.prototype[handler]);
  context.setType('http');
  await new ScopeGuard(new Reflector(), { getScopesByRoles: async () => new Set<string>() }).canActivate(context);
  return request;
};

const permissionStamped = (permissions: string[]) => {
  const request = {};
  recordPermissionDecisions(request, permissions);
  return request;
};

describe('force dispatch decision source by mode', () => {
  it('accepts the permission stamp once enforced and only that', async () => {
    expect(forceDispatchDecisionFrom(permissionStamped(['fulfillment.dispatch.force']), true)).toBeDefined();
    expect(forceDispatchDecisionFrom(await scopeStampedRequest('admin'), true)).toBeUndefined();
  });

  it('ignores the permission stamp while the switch is off', async () => {
    expect(forceDispatchDecisionFrom(permissionStamped(['fulfillment.dispatch.force']), false)).toBeUndefined();
    expect(forceDispatchDecisionFrom(await scopeStampedRequest('admin'), false)).toBeDefined();
  });

  it('keeps a station decision out of the admin-only route in both modes', async () => {
    const station = permissionStamped(['fulfillment.dispatch.station_force']);
    expect(adminForceDispatchDecisionFrom(station, true)).toBeUndefined();
    expect(adminForceDispatchDecisionFrom(await scopeStampedRequest('station'), false)).toBeUndefined();
    const issued = forceDispatchDecisionFrom(station, true);
    expect(isForceDispatchDecision(issued)).toBe(true);
    expect(isAdminForceDispatchDecision(issued)).toBe(false);
  });

  it('prefers the admin decision when both are stamped', () => {
    const both = permissionStamped(['fulfillment.dispatch.station_force', 'fulfillment.dispatch.force']);
    const chosen = forceDispatchDecisionFrom(both, true);
    expect(chosen && forceDispatchDecisionKey(chosen)).toBe('fulfillment.dispatch.force');
  });

  it('records the same audit key in both modes', async () => {
    const fromPermission = forceDispatchDecisionFrom(permissionStamped(['fulfillment.dispatch.force']), true);
    const fromScope = forceDispatchDecisionFrom(await scopeStampedRequest('admin'), false);
    expect(fromPermission && forceDispatchDecisionKey(fromPermission)).toBe('fulfillment.dispatch.force');
    expect(fromScope && forceDispatchDecisionKey(fromScope)).toBe('fulfillment.dispatch.force');
    expect(fromPermission && forceDispatchDecisionSource(fromPermission)).toBe('permission_guard');
    expect(fromScope && forceDispatchDecisionSource(fromScope)).toBe('scope_guard');
  });

  it('rejects a look-alike permission decision', () => {
    expect(isForceDispatchDecision({ permission: 'fulfillment.dispatch.force', granted: true })).toBe(false);
  });
});
