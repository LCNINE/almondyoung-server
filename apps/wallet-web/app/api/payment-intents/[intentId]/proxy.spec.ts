import { proxyPaymentIntentAction } from './proxy';

describe('payment intent proxy', () => {
  const originalFetch = global.fetch;
  const originalWalletApiUrl = process.env.WALLET_API_URL;
  const originalPublicWalletApiUrl = process.env.NEXT_PUBLIC_WALLET_API_URL;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.WALLET_API_URL = originalWalletApiUrl;
    process.env.NEXT_PUBLIC_WALLET_API_URL = originalPublicWalletApiUrl;
    jest.restoreAllMocks();
  });

  it('forwards confirm requests with wallet-web cookies to the wallet API', async () => {
    process.env.WALLET_API_URL = 'https://wallet-api.example.com';
    global.fetch = jest.fn(async () =>
      Response.json({ id: 'pi_123', status: 'SUCCEEDED', returnUrl: null }),
    ) as unknown as typeof fetch;
    const body = JSON.stringify({ paymentMethodId: 'pm_123', pointsToApply: 1000 });
    const request = new Request('https://wallet-web.example.com/api/payment-intents/pi_123/confirm', {
      method: 'POST',
      headers: {
        Cookie: 'accessToken=fresh; refreshToken=refresh',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_123',
      },
      body,
    });

    const response = await proxyPaymentIntentAction(request, 'pi_123', 'confirm');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'pi_123', status: 'SUCCEEDED', returnUrl: null });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://wallet-api.example.com/v1/payment-intents/pi_123/confirm',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        body,
        headers: expect.objectContaining({
          Cookie: 'accessToken=fresh; refreshToken=refresh',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem_123',
        }),
      }),
    );
  });

  it('forwards cancel requests without requiring a body', async () => {
    process.env.WALLET_API_URL = 'https://wallet-api.example.com';
    global.fetch = jest.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const request = new Request('https://wallet-web.example.com/api/payment-intents/pi_123/cancel', {
      method: 'POST',
      headers: {
        Cookie: 'accessToken=fresh',
      },
    });

    const response = await proxyPaymentIntentAction(request, 'pi_123', 'cancel');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://wallet-api.example.com/v1/payment-intents/pi_123/cancel',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        headers: expect.objectContaining({
          Cookie: 'accessToken=fresh',
          'Idempotency-Key': expect.any(String),
        }),
      }),
    );
    expect(init.body).toBeUndefined();
  });
});
