jest.mock('@/const', () => ({ WALLET_SERVICE_BASE_URL: '/wallet' }), {
  virtual: true,
});

jest.mock('../../client', () => ({
  client: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
  },
}));

import { client } from '../../client';
import { walletApi } from './index';

const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000000';
const idempotencyConfig = {
  headers: { 'Idempotency-Key': IDEMPOTENCY_KEY },
};

const mockedClient = client as unknown as {
  post: jest.Mock;
  patch: jest.Mock;
  put: jest.Mock;
};

describe('walletApi payment config writes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(crypto, 'randomUUID').mockReturnValue(IDEMPOTENCY_KEY);
    mockedClient.post.mockResolvedValue({ data: {} });
    mockedClient.patch.mockResolvedValue({ data: {} });
    mockedClient.put.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends an Idempotency-Key when updating the payment method catalog', async () => {
    await walletApi.updatePaymentMethodCatalog('TOSS', { isEnabled: false });

    expect(mockedClient.patch).toHaveBeenCalledWith(
      '/wallet/v1/admin/payment-methods/TOSS',
      { isEnabled: false },
      idempotencyConfig
    );
  });

  it('sends an Idempotency-Key when creating a region', async () => {
    await walletApi.createRegion({ code: 'kr', name: 'Korea' });

    expect(mockedClient.post).toHaveBeenCalledWith(
      '/wallet/v1/admin/regions',
      { code: 'kr', name: 'Korea' },
      idempotencyConfig
    );
  });

  it('sends an Idempotency-Key when toggling a region', async () => {
    await walletApi.updateRegion('kr', { isActive: false });

    expect(mockedClient.patch).toHaveBeenCalledWith(
      '/wallet/v1/admin/regions/kr',
      { isActive: false },
      idempotencyConfig
    );
  });

  it('sends an Idempotency-Key when saving region payment methods', async () => {
    const items = [{ code: 'TOSS', isEnabled: false, sortOrder: 10 }];

    await walletApi.putRegionPaymentMethods('kr', items);

    expect(mockedClient.put).toHaveBeenCalledWith(
      '/wallet/v1/admin/regions/kr/payment-methods',
      { items },
      idempotencyConfig
    );
  });
});
