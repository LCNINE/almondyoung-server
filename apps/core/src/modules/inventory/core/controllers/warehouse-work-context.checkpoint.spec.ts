import { createCheckpointsForTesting } from '@app/authorization';
import { WarehouseWorkContextController } from './warehouse-work-context.controller';

describe('WarehouseWorkContextController permission preview', () => {
  it('derives each flag from the role permissions', () => {
    const controller = new WarehouseWorkContextController(
      createCheckpointsForTesting({
        logistics_worker: ['fulfillment.dispatch.station_force', 'fulfillment.shipment.short_pick'],
      }),
    );
    const result = controller.workContext({ userId: 'w-1', roles: ['logistics_worker'] });
    expect(result.permissions).toEqual({ forceDispatch: false, stationForceDispatch: true, shortPick: true });
  });

  it('opens every flag through dispatch.force and shipment.reopen', () => {
    const controller = new WarehouseWorkContextController(
      createCheckpointsForTesting({ lead: ['fulfillment.dispatch.force', 'fulfillment.shipment.reopen'] }),
    );
    const result = controller.workContext({ userId: 'w-1', roles: ['lead'] });
    expect(result.permissions).toEqual({ forceDispatch: true, stationForceDispatch: true, shortPick: true });
  });

  it('closes every flag before the permission copy arrives', () => {
    const controller = new WarehouseWorkContextController(createCheckpointsForTesting(null));
    const result = controller.workContext({ userId: 'w-1', roles: ['admin'] });
    expect(result.permissions).toEqual({ forceDispatch: false, stationForceDispatch: false, shortPick: false });
  });
});
