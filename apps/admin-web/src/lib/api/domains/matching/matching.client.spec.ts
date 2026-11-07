jest.mock('@/const', () => ({ ALMONDYOUNG_API_BASE_URL: '/core' }), {
  virtual: true,
});
jest.mock('../../client', () => ({
  client: { get: jest.fn(), post: jest.fn() },
}));

import { client } from '../../client';
import { matchingClient } from './matching.client';

const get = jest.mocked(client.get);
const post = jest.mocked(client.post);

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue({ data: {} });
  post.mockResolvedValue({ data: {} });
});

it.each([true, false])(
  'sends excludeShipped only when enabled=%s',
  async (excludeShipped) => {
    await matchingClient.getOrderLines({
      excludeShipped,
      limit: 50,
      offset: 100,
    });

    expect(get).toHaveBeenCalledWith(
      `/core/matchings/order-lines?${excludeShipped ? 'excludeShipped=true&' : ''}limit=50&offset=100`
    );
  }
);

it('previews with GET and applies with POST without client candidate IDs', async () => {
  const preview = { candidates: 2, waitingOrderCandidates: 1, sample: [] };
  const applied = { resolved: 2, skipped: 0, failed: [] };
  get.mockResolvedValue({ data: preview });
  post.mockResolvedValue({ data: applied });

  expect(await matchingClient.previewNameMatch()).toEqual(preview);
  expect(await matchingClient.applyNameMatch()).toEqual(applied);
  expect(get).toHaveBeenCalledWith('/core/matchings/name-match/preview');
  expect(post).toHaveBeenCalledWith('/core/matchings/name-match/apply');
});
