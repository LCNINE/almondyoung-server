import { checkpointEvaluations, createCheckpointsForTesting, ScopeGuard } from '@app/authorization';
import { register } from 'prom-client';
import { FULFILLMENT_SCOPE } from '../../../../platform/auth/fulfillment-scopes';
import { WarehouseWorkContextController } from './warehouse-work-context.controller';

describe('WarehouseWorkContextController permission comparison', () => {
  beforeEach(() => register.resetMetrics());

  it('returns the legacy preview and compares each flag with permissions', async () => {
    const scopes: Pick<ScopeGuard, 'getGrantedScopes'> = {
      getGrantedScopes: jest.fn(async () => [
        FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE,
        FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK,
      ]),
    };
    const controller = new WarehouseWorkContextController(
      scopes,
      createCheckpointsForTesting({
        logistics_worker: ['fulfillment.dispatch.station_force', 'fulfillment.shipment.short_pick'],
      }),
    );
    const result = await controller.workContext({ userId: 'w-1', roles: ['logistics_worker'] });
    expect(result.permissions).toEqual({ forceDispatch: false, stationForceDispatch: true, shortPick: true });
    expect(await checkpointEvaluations('inventory.work_context', 'match')).toBe(3);
  });
});
