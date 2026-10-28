import { FULFILLMENT_ROLE_MAPPINGS, FULFILLMENT_SCOPE, FULFILLMENT_SCOPES } from './fulfillment-scopes';

describe('fulfillment authorization contract', () => {
  const scopeKeys = Object.values(FULFILLMENT_SCOPE);
  const roleScopes = new Map(FULFILLMENT_ROLE_MAPPINGS.map((mapping) => [mapping.roleName, mapping.scopeKeys]));

  it('registers the designed operator scopes and the isolated tracking-ingest scope', () => {
    expect(FULFILLMENT_SCOPES.map((scope) => scope.key)).toEqual([
      'fulfillment.warehouse.operate',
      'fulfillment.shipment.consolidate',
      'fulfillment.shipment.override_recipient',
      'fulfillment.reservation.transfer',
      'fulfillment.dispatch.force',
      'fulfillment.dispatch.recall',
      'fulfillment.shipment.reopen',
      'fulfillment.tracking.ingest',
      'fulfillment.shipment.short_pick',
      'fulfillment.dispatch.station_force',
    ]);
    expect(new Set(scopeKeys)).toHaveProperty('size', 10);
  });

  it('gives the worker only operate + station short-pick/force, never the manager scopes', () => {
    expect(roleScopes.get('logistics_worker')).toEqual([
      FULFILLMENT_SCOPE.WAREHOUSE_OPERATE,
      FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK,
      FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE,
    ]);
    expect(roleScopes.get('logistics_worker')).not.toContain(FULFILLMENT_SCOPE.SHIPMENT_REOPEN);
    expect(roleScopes.get('logistics_worker')).not.toContain(FULFILLMENT_SCOPE.DISPATCH_FORCE);
    expect(roleScopes.get('logistics_manager')).toEqual(
      scopeKeys.filter((scope) => scope !== FULFILLMENT_SCOPE.TRACKING_INGEST),
    );
  });
});
