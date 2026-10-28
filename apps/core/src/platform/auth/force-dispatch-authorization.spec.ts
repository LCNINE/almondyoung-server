import {
  getPermissionDecision,
  recordPermissionDecisions,
  RequireScopes,
  SCOPE_AUTHORIZATION_DECISION_BRAND,
  ScopeGuard,
} from '@app/authorization';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { FULFILLMENT_PERMISSION } from './fulfillment-permissions';
import {
  adminForceDispatchDecisionFrom,
  FORCE_DISPATCH_AUTHORIZATION_SOURCE,
  forceDispatchDecisionFrom,
  forceDispatchDecisionKey,
  isAdminForceDispatchDecision,
  isForceDispatchDecision,
} from './force-dispatch-authorization';

const permissionStamped = (permissions: string[]) => {
  const request = {};
  recordPermissionDecisions(request, permissions);
  return request;
};

describe('isForceDispatchDecision', () => {
  it.each([
    ['관리자 강제출고', FULFILLMENT_PERMISSION.DISPATCH_FORCE, true],
    ['스테이션 강제출고', FULFILLMENT_PERMISSION.DISPATCH_STATION_FORCE, true],
    ['다른 권한', FULFILLMENT_PERMISSION.WAREHOUSE_OPERATE, false],
  ])('%s → %s', (_name, permission, expected) => {
    expect(isForceDispatchDecision(forceDecisionOf(permission))).toBe(expected);
  });

  it.each([
    [
      '옛 스코프 판정 객체',
      { scope: FULFILLMENT_PERMISSION.DISPATCH_FORCE, granted: true, [SCOPE_AUTHORIZATION_DECISION_BRAND]: true },
    ],
    ['낙인 없이 만든 객체', { permission: FULFILLMENT_PERMISSION.DISPATCH_FORCE, granted: true }],
    ['판정 없음', undefined],
  ])('%s → false', (_name, value) => {
    expect(isForceDispatchDecision(value)).toBe(false);
  });
});

/** 그 권한 하나만 낙인한 요청에서 판정 객체를 꺼낸다. */
const forceDecisionOf = (permission: string) => getPermissionDecision(permissionStamped([permission]), permission);

class ForceRoutes {
  @RequireScopes(FULFILLMENT_PERMISSION.DISPATCH_FORCE)
  admin(): void {}
}

/** 옛 판정 낙인은 ScopeGuard 를 실제로 통과시켜 만든다(위조 불가 낙인이라 손으로 못 만든다). */
const scopeStampedRequest = async () => {
  const request = { user: { userId: 'u-master', sub: 'u-master', roles: ['master'] } };
  const context = new ExecutionContextHost([request, {}], ForceRoutes, ForceRoutes.prototype.admin);
  context.setType('http');
  await new ScopeGuard(new Reflector(), { getScopesByRoles: async () => new Set<string>() }).canActivate(context);
  return request;
};

describe('force dispatch decision', () => {
  it('accepts the permission stamp', () => {
    expect(forceDispatchDecisionFrom(permissionStamped(['fulfillment.dispatch.force']))).toBeDefined();
    expect(adminForceDispatchDecisionFrom(permissionStamped(['fulfillment.dispatch.force']))).toBeDefined();
  });

  it('rejects a request carrying only the ScopeGuard stamp', async () => {
    const request = await scopeStampedRequest();
    expect(forceDispatchDecisionFrom(request)).toBeUndefined();
    expect(adminForceDispatchDecisionFrom(request)).toBeUndefined();
  });

  it('keeps a station decision out of the admin-only route', () => {
    const station = permissionStamped(['fulfillment.dispatch.station_force']);
    expect(adminForceDispatchDecisionFrom(station)).toBeUndefined();
    const issued = forceDispatchDecisionFrom(station);
    expect(isForceDispatchDecision(issued)).toBe(true);
    expect(isAdminForceDispatchDecision(issued)).toBe(false);
  });

  it('prefers the admin decision when both are stamped', () => {
    const both = permissionStamped(['fulfillment.dispatch.station_force', 'fulfillment.dispatch.force']);
    const chosen = forceDispatchDecisionFrom(both);
    expect(chosen && forceDispatchDecisionKey(chosen)).toBe('fulfillment.dispatch.force');
  });

  it('records the permission key and the permission guard as the audit source', () => {
    const chosen = forceDispatchDecisionFrom(permissionStamped(['fulfillment.dispatch.station_force']));
    expect(chosen && forceDispatchDecisionKey(chosen)).toBe('fulfillment.dispatch.station_force');
    expect(FORCE_DISPATCH_AUTHORIZATION_SOURCE).toBe('permission_guard');
  });
});
