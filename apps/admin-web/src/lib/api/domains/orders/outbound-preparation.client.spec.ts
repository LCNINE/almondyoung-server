jest.mock('@/const', () => ({ ALMONDYOUNG_API_BASE_URL: '/core' }));
jest.mock('../../client', () => ({
  client: { get: jest.fn(), post: jest.fn() },
}));

import { client } from '../../client';
import { createIdempotentCommand } from '../../../services/orders/idempotency';
import type {
  BulkShipmentResult,
  OutboundPreparationSummary,
} from '../../../types/dto/fulfillment';
import { outboundPreparationClient } from './outbound-preparation.client';

const KEY = '4e8e3b7f-37df-41fb-a084-47915ba7b6cf';
const command = createIdempotentCommand({ shipmentIds: ['s-1', 's-2'] }, KEY);
const mocked = jest.mocked(client);
const result: BulkShipmentResult = {
  succeeded: ['s-1'],
  failed: [
    {
      shipmentId: 's-2',
      code: 'SHIPMENT_NOT_DRAFT',
      message: '상자 상태가 바뀌었어요',
      transient: false,
    },
  ],
};

describe('outboundPreparationClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.post.mockResolvedValue({ data: result });
  });

  it('reads the warehouse summary using query params', async () => {
    const summary: OutboundPreparationSummary = {
      warehouseId: 'warehouse-1',
      buckets: [
        {
          bucket: 'ready',
          count: 1,
          singleCount: 1,
          multiCount: 0,
          shipments: [
            {
              shipmentId: 's-1',
              orderNos: ['order-1'],
              itemSummary: '상품 1',
              totalQty: 2,
              single: true,
              reason: null,
            },
          ],
        },
      ],
      awaitingMatchingCount: 3,
    };
    mocked.get.mockResolvedValue({ data: summary });

    await expect(
      outboundPreparationClient.summary('warehouse-1')
    ).resolves.toBe(summary);

    expect(mocked.get).toHaveBeenCalledWith('/core/outbound-preparation', {
      params: { warehouseId: 'warehouse-1' },
    });
  });

  it('passes bucket and offset through the existing summary route', async () => {
    mocked.get.mockResolvedValue({ data: { buckets: [] } });

    await outboundPreparationClient.summary('warehouse-1', {
      bucket: 'ready',
      offset: 200,
    });

    expect(mocked.get).toHaveBeenCalledWith('/core/outbound-preparation', {
      params: { warehouseId: 'warehouse-1', bucket: 'ready', offset: 200 },
    });
  });

  const mutations = [
    {
      name: 'planMany',
      run: () => outboundPreparationClient.planMany(command),
      path: '/core/outbound-preparation/plans',
    },
    {
      name: 'issueWaybills',
      run: () => outboundPreparationClient.issueWaybills(command),
      path: '/core/outbound-preparation/waybills',
    },
    {
      name: 'addManyToBatch',
      run: () => outboundPreparationClient.addManyToBatch('batch/1', command),
      path: '/core/outbound-preparation/batches/batch%2F1/shipments',
    },
    {
      name: 'splitManyUnreserved',
      run: () => outboundPreparationClient.splitManyUnreserved(command),
      path: '/core/outbound-preparation/unreserved-splits',
    },
  ];

  it.each(mutations)(
    '$name preserves the body, key and partial result on retry',
    async ({ run, path }) => {
      await expect(run()).resolves.toBe(result);
      await expect(run()).resolves.toBe(result);

      expect(mocked.post).toHaveBeenCalledTimes(2);
      expect(mocked.post).toHaveBeenNthCalledWith(1, path, command.data, {
        headers: { 'Idempotency-Key': KEY },
      });
      expect(mocked.post).toHaveBeenNthCalledWith(2, path, command.data, {
        headers: { 'Idempotency-Key': KEY },
      });
    }
  );

  it.each(mutations)('$name propagates request failures', async ({ run }) => {
    const error = new Error('network error');
    mocked.post.mockRejectedValueOnce(error);

    await expect(run()).rejects.toBe(error);
  });
});
