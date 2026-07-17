import { ScopeGuard } from '@app/authorization';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ConsolidationController } from '../controllers/consolidation.controller';
import { ShipmentPlanningController } from '../controllers/shipment-planning.controller';
import { ShipmentRecallController } from '../controllers/shipment-recall.controller';
import { ShipmentTrackingController } from '../controllers/shipment-tracking.controller';
import { ShipmentController } from '../controllers/shipment.controller';
import { WaybillController } from '../waybill/waybill.controller';
import { FULFILLMENT_ROLE_MAPPINGS, FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';

type ControllerEndpoint = {
  name: string;
  controller: object;
  handlerName: string;
  scope: string;
};

function handlerFor(endpoint: ControllerEndpoint): object {
  return (endpoint.controller as { prototype: Record<string, object> }).prototype[endpoint.handlerName];
}

const AUTHORIZED_ENDPOINTS = [
  {
    name: 'warehouse planning',
    controller: ShipmentPlanningController,
    handlerName: 'plan',
    scope: FULFILLMENT_SCOPE.WAREHOUSE_OPERATE,
  },
  {
    name: 'cross-order consolidation',
    controller: ConsolidationController,
    handlerName: 'consolidate',
    scope: FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE,
  },
  {
    name: 'recipient override',
    controller: ShipmentPlanningController,
    handlerName: 'reviseRecipient',
    scope: FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT,
  },
  {
    name: 'forced dispatch',
    controller: ShipmentController,
    handlerName: 'forceDispatch',
    scope: FULFILLMENT_SCOPE.DISPATCH_FORCE,
  },
  {
    name: 'dispatch recall',
    controller: ShipmentRecallController,
    handlerName: 'report',
    scope: FULFILLMENT_SCOPE.DISPATCH_RECALL,
  },
  {
    name: 'waybill void/reopen',
    controller: WaybillController,
    handlerName: 'void',
    scope: FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
  },
  {
    name: 'trusted tracking ingest',
    controller: ShipmentTrackingController,
    handlerName: 'record',
    scope: FULFILLMENT_SCOPE.TRACKING_INGEST,
  },
] satisfies ControllerEndpoint[];

describe('outbound V2 authorization matrix', () => {
  const roleScopes = new Map(
    FULFILLMENT_ROLE_MAPPINGS.map((mapping) => [mapping.roleName, new Set(mapping.scopeKeys)]),
  );
  const authorizationService = {
    getScopesByRoles: jest.fn((roles: string[]) => {
      const scopes = new Set<string>();
      for (const role of roles) {
        for (const scope of roleScopes.get(role) ?? []) scopes.add(scope);
      }
      return Promise.resolve(scopes);
    }),
  };
  const guard = new ScopeGuard(new Reflector(), authorizationService as never);

  function contextFor(endpoint: ControllerEndpoint, roles?: string[], body = {}) {
    const request = { user: roles ? { id: 'jwt-actor', roles } : undefined, body };
    return {
      request,
      context: {
        getHandler: () => handlerFor(endpoint),
        getClass: () => endpoint.controller,
        switchToHttp: () => ({ getRequest: () => request }),
      } as never,
    };
  }

  it.each(AUTHORIZED_ENDPOINTS)('$name uses its exact scope and the real ScopeGuard', (endpoint) => {
    const handler = handlerFor(endpoint);
    expect(Reflect.getMetadata('required_scopes', handler)).toEqual([endpoint.scope]);

    const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[];
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, endpoint.controller) ?? []) as unknown[];
    expect([...methodGuards, ...classGuards]).toContain(ScopeGuard);
  });

  it.each(AUTHORIZED_ENDPOINTS)('applies worker and manager grants to $name', async (endpoint) => {
    const workerAllowed = endpoint.scope === FULFILLMENT_SCOPE.WAREHOUSE_OPERATE;
    const managerAllowed = endpoint.scope !== FULFILLMENT_SCOPE.TRACKING_INGEST;

    await expect(guard.canActivate(contextFor(endpoint, ['logistics_worker']).context)).resolves.toBe(workerAllowed);
    await expect(guard.canActivate(contextFor(endpoint, ['logistics_manager']).context)).resolves.toBe(managerAllowed);
  });

  it('denies unknown roles, a role with a missing scope, and a missing authenticated role set', async () => {
    const forcedDispatch = AUTHORIZED_ENDPOINTS.find(
      (endpoint) => endpoint.scope === FULFILLMENT_SCOPE.DISPATCH_FORCE,
    )!;
    roleScopes.set('warehouse_only_custom_role', new Set([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]));

    await expect(guard.canActivate(contextFor(forcedDispatch, ['unknown_role']).context)).resolves.toBe(false);
    await expect(guard.canActivate(contextFor(forcedDispatch, ['warehouse_only_custom_role']).context)).resolves.toBe(
      false,
    );
    await expect(guard.canActivate(contextFor(forcedDispatch).context)).resolves.toBe(false);
  });

});
