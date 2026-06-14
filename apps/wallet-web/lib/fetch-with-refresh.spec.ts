import { WalletSessionExpiredError } from './auth-expired';
import { fetchWithAuthBounce } from './fetch-with-refresh';

describe('fetchWithAuthBounce', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns non-401 responses without an auth refresh attempt', async () => {
    global.fetch = jest.fn(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;

    const response = await fetchWithAuthBounce('https://wallet-api.example.com/v1/payment-intents/pi_123/confirm', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws a session-expired error on 401 without calling /api/auth/refresh', async () => {
    global.fetch = jest.fn(async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;

    await expect(
      fetchWithAuthBounce('https://wallet-api.example.com/v1/payment-intents/pi_123/confirm', { method: 'POST' }),
    ).rejects.toBeInstanceOf(WalletSessionExpiredError);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalledWith('/api/auth/refresh', expect.anything());
  });
});
