import { cancelPaymentIntent, confirmPaymentIntent, getTossWidgetConfig } from './wallet-api';

describe('wallet payment mutations', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('confirms payment through the wallet-web same-origin API route', async () => {
    global.fetch = jest.fn(async () =>
      Response.json({ id: 'pi_123', status: 'SUCCEEDED', returnUrl: null }),
    ) as unknown as typeof fetch;

    await confirmPaymentIntent('pi_123', 'pm_123', 1000);

    const [input, init] = (global.fetch as jest.Mock).mock.calls[0] as [RequestInfo | URL, RequestInit];

    expect(input).toBe('/api/payment-intents/pi_123/confirm');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ paymentMethodId: 'pm_123', pointsToApply: 1000 }),
    });
    expect(init.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'Idempotency-Key': expect.any(String),
      }),
    );
  });

  it('cancels payment through the wallet-web same-origin API route', async () => {
    global.fetch = jest.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    await cancelPaymentIntent('pi_123');

    const [input, init] = (global.fetch as jest.Mock).mock.calls[0] as [RequestInfo | URL, RequestInit];

    expect(input).toBe('/api/payment-intents/pi_123/cancel');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
    });
    expect(init.headers).toEqual(
      expect.objectContaining({
        'Idempotency-Key': expect.any(String),
      }),
    );
  });

  it('distinguishes an unconfigured widget from failed configuration lookup', async () => {
    global.fetch = jest.fn().mockResolvedValue(Response.json(null));
    await expect(getTossWidgetConfig()).resolves.toBeNull();
    global.fetch = jest.fn().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(getTossWidgetConfig()).rejects.toMatchObject({ name: 'WalletSessionExpiredError' });
    global.fetch = jest.fn().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(getTossWidgetConfig()).rejects.toThrow('503');
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));
    await expect(getTossWidgetConfig()).rejects.toThrow('network');
  });
});
