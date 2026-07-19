jest.mock('@/const', () => ({ ALMONDYOUNG_API_BASE_URL: '/core' }), {
  virtual: true,
});
jest.mock('../../client', () => ({
  client: { get: jest.fn(), post: jest.fn() },
}));

import { client } from '../../client';
import { waybillsClient } from './waybills.client';

const KEY = '4e8e3b7f-37df-41fb-a084-47915ba7b6cf';
const config = { headers: { 'Idempotency-Key': KEY } };
const mocked = client as unknown as { get: jest.Mock; post: jest.Mock };

describe('waybillsClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.get.mockResolvedValue({ data: {} });
    mocked.post.mockResolvedValue({ data: {} });
  });

  it('issues, manual-registers and reissues with idempotency header', async () => {
    await waybillsClient.issue(
      's/1',
      { carrier: 'HANJIN', expectedManifestVersion: 2 },
      KEY
    );
    await waybillsClient.manual(
      's/1',
      {
        carrier: 'HANJIN',
        expectedManifestVersion: 2,
        trackingNo: '1234',
        reason: 'x',
      },
      KEY
    );
    await waybillsClient.reissue(
      's/1',
      { carrier: 'HANJIN', expectedManifestVersion: 2 },
      KEY
    );

    expect(mocked.post).toHaveBeenNthCalledWith(
      1,
      '/core/shipments/s%2F1/waybills',
      { carrier: 'HANJIN', expectedManifestVersion: 2 },
      config
    );
    expect(mocked.post).toHaveBeenNthCalledWith(
      2,
      '/core/shipments/s%2F1/waybills/manual',
      expect.objectContaining({ trackingNo: '1234' }),
      config
    );
    expect(mocked.post).toHaveBeenNthCalledWith(
      3,
      '/core/shipments/s%2F1/waybills/reissue',
      expect.any(Object),
      config
    );
  });

  it('batch-issues and voids and reads active waybill', async () => {
    await waybillsClient.batch(
      { shipmentIds: ['a', 'b'], carrier: 'HANJIN' },
      KEY
    );
    await waybillsClient.void('w/1', { reason: 'mistake' }, KEY);
    await waybillsClient.getActive('s-1');

    expect(mocked.post).toHaveBeenNthCalledWith(
      1,
      '/core/waybills:batch',
      { shipmentIds: ['a', 'b'], carrier: 'HANJIN' },
      config
    );
    expect(mocked.post).toHaveBeenNthCalledWith(
      2,
      '/core/waybills/w%2F1/void',
      { reason: 'mistake' },
      config
    );
    expect(mocked.get).toHaveBeenCalledWith('/core/shipments/s-1/waybill');
  });
});
