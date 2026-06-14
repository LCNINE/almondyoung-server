import { cancelPaymentIntent, confirmPaymentIntent } from './wallet-api';

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
});
