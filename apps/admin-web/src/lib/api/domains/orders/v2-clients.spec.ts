jest.mock('@/const', () => ({ ALMONDYOUNG_API_BASE_URL: '/core' }), {
  virtual: true,
});

jest.mock('../../client', () => ({
  client: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

import { client } from '../../client';
import { fulfillmentOrder } from './fulfillment-order.client';
import { invoicesClient } from './invoices.client';
import { outboundBatchesClient } from './outbound-batches.client';
import { pickingClient } from './picking.client';

const KEY = '4e8e3b7f-37df-41fb-a084-47915ba7b6cf';
const config = { headers: { 'Idempotency-Key': KEY } };
const mockedClient = client as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
};

describe('fulfillment V2 typed clients', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedClient.get.mockResolvedValue({ data: [] });
    mockedClient.post.mockResolvedValue({
      data: { operationId: 'operation-1' },
    });
    mockedClient.patch.mockResolvedValue({
      data: { operationId: 'operation-1' },
    });
  });

  it('uses shipment list/detail and durable operation read paths', async () => {
    await fulfillmentOrder.getShipments('fo/1');
    await fulfillmentOrder.getShipment('shipment/1');
    await fulfillmentOrder.getOperation('operation/1');

    expect(mockedClient.get).toHaveBeenNthCalledWith(
      1,
      '/core/fulfillments/fo%2F1/shipments'
    );
    expect(mockedClient.get).toHaveBeenNthCalledWith(
      2,
      '/core/shipments/shipment%2F1'
    );
    expect(mockedClient.get).toHaveBeenNthCalledWith(
      3,
      '/core/fulfillment-operations/operation%2F1'
    );
  });

  it('reuses the caller-owned key for planning, invoice, batch, and picking commands', async () => {
    await fulfillmentOrder.planShipment(
      'shipment-1',
      {
        shippingProfileId: '10000000-0000-4000-8000-000000000001',
        expectedManifestVersion: 2,
        expectedReservationVersion: 3,
      },
      KEY
    );
    await invoicesClient.issueForShipment(
      'shipment-1',
      {
        expectedManifestVersion: 2,
        provider: 'goodsflow',
        carrierCode: 'CJ',
        reason: 'dispatch',
      },
      KEY
    );
    await outboundBatchesClient.createV2(
      {
        warehouseId: '10000000-0000-4000-8000-000000000002',
        pickingMethod: 'individual',
      },
      KEY
    );
    await pickingClient.createPlan(
      { strategy: 'discrete', batchId: 'batch-1', shipmentIds: ['shipment-1'] },
      KEY
    );

    expect(mockedClient.post).toHaveBeenNthCalledWith(
      1,
      '/core/shipments/shipment-1/plan',
      expect.any(Object),
      config
    );
    expect(mockedClient.post).toHaveBeenNthCalledWith(
      2,
      '/core/shipments/shipment-1/invoices',
      expect.any(Object),
      config
    );
    expect(mockedClient.post).toHaveBeenNthCalledWith(
      3,
      '/core/outbound-batches/v2',
      expect.any(Object),
      config
    );
    expect(mockedClient.post).toHaveBeenNthCalledWith(
      4,
      '/core/picking/v2/plans',
      expect.any(Object),
      config
    );
  });
});
