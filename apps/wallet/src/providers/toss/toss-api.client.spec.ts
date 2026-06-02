import { TossApiClient } from './toss-api.client';

describe('TossApiClient', () => {
  const originalFetch = global.fetch;
  const originalSecretKey = process.env.TOSS_SECRET_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.TOSS_SECRET_KEY = originalSecretKey;
    jest.restoreAllMocks();
  });

  it('calls the Toss cancel endpoint with the paymentKey and idempotency key', async () => {
    process.env.TOSS_SECRET_KEY = 'test_sk_secret';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ paymentKey: 'pay_123', cancels: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new TossApiClient();
    const result = await client.cancelPayment('pay_123', '고객 요청', 4000, 'wallet:refund:refund-id');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://api.tosspayments.com/v1/payments/pay_123/cancel', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from('test_sk_secret:').toString('base64')}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'wallet:refund:refund-id',
      },
      body: JSON.stringify({ cancelReason: '고객 요청', cancelAmount: 4000 }),
    });
  });

  it('serializes object-shaped Toss error messages instead of returning [object Object]', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: jest.fn().mockResolvedValue({
        message: {
          timestamp: '2026-06-01T23:03:34.735+00:00',
          status: 404,
          error: 'Not Found',
          path: '/v1/payments/pay_123/cancels',
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new TossApiClient();
    const result = await client.cancelPayment('pay_123', '고객 요청', 4000);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN');
      expect(result.error.message).toContain('"status":404');
      expect(result.error.message).not.toBe('[object Object]');
    }
  });
});
