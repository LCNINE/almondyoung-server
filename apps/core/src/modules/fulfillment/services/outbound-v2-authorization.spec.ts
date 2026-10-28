import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { enforcedPermissionProvidersForTesting, PermissionGuard, REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { LocationOutboundController } from '../controllers/location-outbound.controller';
import { ConsolidationController } from '../controllers/consolidation.controller';
import { ShipmentPlanningController } from '../controllers/shipment-planning.controller';
import { ShipmentRecallController } from '../controllers/shipment-recall.controller';
import { ShipmentTrackingController } from '../controllers/shipment-tracking.controller';
import { ShipmentController } from '../controllers/shipment.controller';
import { WaybillController } from '../waybill/waybill.controller';

type ControllerEndpoint = {
  name: string;
  controller: object;
  handlerName: string;
  permission: string;
};

function handlerFor(endpoint: ControllerEndpoint): object {
  return (endpoint.controller as { prototype: Record<string, object> }).prototype[endpoint.handlerName];
}

const OPERATE = 'fulfillment.warehouse.operate';
const TRACKING_INGEST = 'fulfillment.tracking.ingest';

const AUTHORIZED_ENDPOINTS = [
  {
    name: 'force result resolution',
    controller: LocationOutboundController,
    handlerName: 'resolveForce',
    permission: OPERATE,
  },
  {
    name: 'warehouse planning',
    controller: ShipmentPlanningController,
    handlerName: 'plan',
    permission: OPERATE,
  },
  {
    name: 'cross-order consolidation',
    controller: ConsolidationController,
    handlerName: 'consolidate',
    permission: 'fulfillment.shipment.consolidate',
  },
  {
    name: 'recipient override',
    controller: ShipmentPlanningController,
    handlerName: 'reviseRecipient',
    permission: 'fulfillment.shipment.override_recipient',
  },
  {
    name: 'forced dispatch',
    controller: ShipmentController,
    handlerName: 'forceDispatch',
    permission: 'fulfillment.dispatch.force',
  },
  {
    name: 'dispatch recall',
    controller: ShipmentRecallController,
    handlerName: 'report',
    permission: 'fulfillment.dispatch.recall',
  },
  {
    name: 'waybill void/reopen',
    controller: WaybillController,
    handlerName: 'void',
    permission: 'fulfillment.shipment.reopen',
  },
  {
    name: 'trusted tracking ingest',
    controller: ShipmentTrackingController,
    handlerName: 'record',
    permission: TRACKING_INGEST,
  },
] satisfies ControllerEndpoint[];

describe('outbound V2 authorization matrix', () => {
  // 라이브(enforce)와 같은 권한 가드 — 첫 등록 부여 사본으로 판정한다.
  const guard = enforcedPermissionProvidersForTesting()
    .map((provider) => ('useValue' in provider ? provider.useValue : undefined))
    .find((value): value is PermissionGuard => value instanceof PermissionGuard);
  if (!guard) throw new Error('PermissionGuard provider missing');

  function contextFor(endpoint: ControllerEndpoint, roles: string[]) {
    const request = { user: { id: 'jwt-actor', roles }, body: {} };
    return {
      getType: () => 'http',
      getHandler: () => handlerFor(endpoint),
      getClass: () => endpoint.controller,
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;
  }

  it.each(AUTHORIZED_ENDPOINTS)('$name declares its exact permission and no legacy guard', (endpoint) => {
    const handler = handlerFor(endpoint);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toEqual([endpoint.permission]);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, endpoint.controller)).toBeUndefined();
  });

  it.each(AUTHORIZED_ENDPOINTS)('applies worker and manager grants to $name', (endpoint) => {
    const decide = (roles: string[]) => {
      try {
        return guard.canActivate(contextFor(endpoint, roles));
      } catch (error) {
        if (error instanceof ForbiddenException) return false;
        throw error;
      }
    };

    expect(decide(['logistics_worker'])).toBe(endpoint.permission === OPERATE);
    expect(decide(['logistics_manager'])).toBe(endpoint.permission !== TRACKING_INGEST);
    expect(decide(['unknown_role'])).toBe(false);
  });
});
