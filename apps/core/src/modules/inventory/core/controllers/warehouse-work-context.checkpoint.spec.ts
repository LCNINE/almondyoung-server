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
    expect(result.permissions).toEqual({
      stockAdjust: false,
      forceDispatch: false,
      stationForceDispatch: true,
      shortPick: true,
    });
  });

  it('opens every flag through dispatch.force and shipment.reopen', () => {
    const controller = new WarehouseWorkContextController(
      createCheckpointsForTesting({ lead: ['fulfillment.dispatch.force', 'fulfillment.shipment.reopen'] }),
    );
    const result = controller.workContext({ userId: 'w-1', roles: ['lead'] });
    expect(result.permissions).toEqual({
      stockAdjust: false,
      forceDispatch: true,
      stationForceDispatch: true,
      shortPick: true,
    });
  });

  it('closes every flag before the permission copy arrives', () => {
    const controller = new WarehouseWorkContextController(createCheckpointsForTesting(null));
    const result = controller.workContext({ userId: 'w-1', roles: ['admin'] });
    expect(result.permissions).toEqual({
      stockAdjust: false,
      forceDispatch: false,
      stationForceDispatch: false,
      shortPick: false,
    });
  });
});

describe('stock adjustment permission preview', () => {
  it('uses inventory.stock.adjust independently of force dispatch', () => {
    const controller = new WarehouseWorkContextController(
      createCheckpointsForTesting({ adjuster: ['inventory.stock.adjust'] }),
    );

    expect(controller.workContext({ userId: 'w-1', roles: ['adjuster'] }).permissions).toEqual({
      stockAdjust: true,
      forceDispatch: false,
      stationForceDispatch: false,
      shortPick: false,
    });
  });
});
