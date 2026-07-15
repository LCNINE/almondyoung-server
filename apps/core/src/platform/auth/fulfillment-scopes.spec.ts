import { ConfigService } from '@nestjs/config';
import { ScopeGuard } from '@app/authorization';
import { ShipmentController } from '../../modules/fulfillment/controllers/shipment.controller';
import { FulfillmentWorkflowGate } from '../../modules/fulfillment/services/fulfillment-workflow-gate.service';
import { FULFILLMENT_ROLE_MAPPINGS, FULFILLMENT_SCOPE, FULFILLMENT_SCOPES } from './fulfillment-scopes';

describe('fulfillment authorization contract', () => {
  const scopeKeys = Object.values(FULFILLMENT_SCOPE);
  const roleScopes = new Map(FULFILLMENT_ROLE_MAPPINGS.map((mapping) => [mapping.roleName, mapping.scopeKeys]));

  it('registers exactly the seven designed scopes', () => {
    expect(FULFILLMENT_SCOPES.map((scope) => scope.key)).toEqual([
      'fulfillment.warehouse.operate',
      'fulfillment.shipment.consolidate',
      'fulfillment.shipment.override_recipient',
      'fulfillment.reservation.transfer',
      'fulfillment.dispatch.force',
      'fulfillment.dispatch.recall',
      'fulfillment.shipment.reopen',
    ]);
    expect(new Set(scopeKeys)).toHaveProperty('size', 7);
  });

  it('gives a worker only warehouse operate and a manager all seven scopes', () => {
    expect(roleScopes.get('logistics_worker')).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(roleScopes.get('logistics_manager')).toEqual(scopeKeys);
  });

  it('denies an unknown role, a missing mapping and a missing required scope', async () => {
    let requiredScope = FULFILLMENT_SCOPE.WAREHOUSE_OPERATE;
    const reflector = {
      getAllAndOverride: jest.fn(() => [requiredScope]),
    };
    const authorizationService = {
      getScopesByRoles: jest.fn(async (roles: string[]) => {
        return new Set(roles.flatMap((role) => roleScopes.get(role) ?? []));
      }),
    };
    const guard = new ScopeGuard(reflector as never, authorizationService as never);
    const contextFor = (roles?: string[]) =>
      ({
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => ({ user: roles ? { roles } : undefined }) }),
      }) as never;

    await expect(guard.canActivate(contextFor(['logistics_worker']))).resolves.toBe(true);
    requiredScope = FULFILLMENT_SCOPE.DISPATCH_FORCE;
    await expect(guard.canActivate(contextFor(['logistics_worker']))).resolves.toBe(false);
    await expect(guard.canActivate(contextFor(['unknown_logistics_role']))).resolves.toBe(false);
    await expect(guard.canActivate(contextFor())).resolves.toBe(false);

    for (const scope of scopeKeys) {
      requiredScope = scope;
      await expect(guard.canActivate(contextFor(['logistics_manager']))).resolves.toBe(true);
    }
  });

  it('uses the JWT actor even if a legacy request body contains a forged operatorId', async () => {
    const shipmentService = { forceShipment: jest.fn().mockResolvedValue(undefined) };
    const workflowGate = new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'legacy' }));
    const controller = new ShipmentController(shipmentService as never, workflowGate, {} as never);

    await controller.force('11111111-1111-4111-8111-111111111111', { operatorId: 'forged-body-actor' } as never, {
      id: 'jwt-actor',
    });

    expect(shipmentService.forceShipment).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      undefined,
      'jwt-actor',
    );
  });
});
