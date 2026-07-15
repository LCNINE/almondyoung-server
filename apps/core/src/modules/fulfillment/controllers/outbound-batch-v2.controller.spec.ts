import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { OutboundBatchV2Controller } from './outbound-batch-v2.controller';

describe('OutboundBatchV2Controller read snapshot contract', () => {
  it('routes list filters and detail snapshot reads', async () => {
    const batches = {
      listBatches: jest.fn().mockResolvedValue([{ id: 'batch-1' }]),
      getBatch: jest.fn().mockResolvedValue({
        id: 'batch-1',
        warehouse: { supportedPickingStrategies: ['discrete'] },
        workItems: [],
        pickingPlan: null,
        inventorySession: null,
        toteAssignments: [],
      }),
    };
    const controller = new OutboundBatchV2Controller(batches as never);

    await controller.list('warehouse-1', 'created');
    await controller.detail('batch-1');

    expect(batches.listBatches).toHaveBeenCalledWith({ warehouseId: 'warehouse-1', status: 'created' });
    expect(batches.getBatch).toHaveBeenCalledWith('batch-1');
  });

  it('protects list/detail with warehouse operate scope', () => {
    for (const name of ['list', 'detail'] as const) {
      const method = Object.getOwnPropertyDescriptor(OutboundBatchV2Controller.prototype, name)?.value as object;
      expect(Reflect.getMetadata('required_scopes', method)).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    }
  });

  it('rejects an invalid PostgreSQL enum filter before the query', () => {
    const batches = { listBatches: jest.fn() };
    const controller = new OutboundBatchV2Controller(batches as never);
    expect(() => controller.list(undefined, 'not-a-status')).toThrow(/Unsupported outbound batch status/);
    expect(batches.listBatches).not.toHaveBeenCalled();
  });
});
