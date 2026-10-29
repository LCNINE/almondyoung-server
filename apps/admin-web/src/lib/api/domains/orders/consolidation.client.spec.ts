jest.mock('@/const', () => ({ ALMONDYOUNG_API_BASE_URL: '/core' }), {
  virtual: true,
});
jest.mock('../../client', () => ({
  client: { get: jest.fn(), post: jest.fn() },
}));

import { client } from '../../client';
import { consolidationClient } from './consolidation.client';

const mockedGet = jest.mocked(client.get);

describe('consolidationClient.getProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes an empty body to null', async () => {
    mockedGet.mockResolvedValue({ data: '' });

    await expect(consolidationClient.getProgress('s/1')).resolves.toBeNull();
    expect(mockedGet).toHaveBeenCalledWith(
      '/core/shipments/s%2F1/consolidation-progress'
    );
  });

  it('returns the body when a consolidation exists', async () => {
    const body = {
      operationId: 'o1',
      status: 'pending',
      targetShipmentId: null,
      sources: [],
    };
    mockedGet.mockResolvedValue({ data: body });

    await expect(consolidationClient.getProgress('s1')).resolves.toEqual(body);
  });
});
