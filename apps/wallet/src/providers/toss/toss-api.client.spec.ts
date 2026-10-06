import { TossApiClient } from './toss-api.client';

describe('TossApiClient', () => {
  const originalFetch = global.fetch;
  const originalSecretKey = process.env.TOSS_SECRET_KEY;
  const originalWidgetSecretKey = process.env.TOSS_WIDGET_SECRET_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.TOSS_SECRET_KEY = originalSecretKey;
    process.env.TOSS_WIDGET_SECRET_KEY = originalWidgetSecretKey;
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

  it('uses the widget key for widget payments without changing the standard key', async () => {
    process.env.TOSS_SECRET_KEY = 'test_sk_standard';
    process.env.TOSS_WIDGET_SECRET_KEY = 'test_gsk_widget';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ paymentKey: 'pay_123', orderId: 'order_123', status: 'DONE' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new TossApiClient();
    await client.confirmPayment('pay_123', 4000, 'order_123', true);
    await client.getPaymentByOrderId('order_123', true);
    await client.confirmPayment('pay_456', 5000, 'order_456');

    const widgetAuth = `Basic ${Buffer.from('test_gsk_widget:').toString('base64')}`;
    const standardAuth = `Basic ${Buffer.from('test_sk_standard:').toString('base64')}`;
    const calls = fetchMock.mock.calls as unknown as Array<[string, { headers: { Authorization: string } }]>;
    expect(calls[0][1].headers.Authorization).toBe(widgetAuth);
    expect(calls[1][1].headers.Authorization).toBe(widgetAuth);
    expect(calls[2][1].headers.Authorization).toBe(standardAuth);
  });

  it('confirms BrandPay through its dedicated endpoint with the customer and widget secret', async () => {
    process.env.TOSS_WIDGET_SECRET_KEY = 'test_gsk_widget';
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue({ paymentKey: 'pay_brandpay' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await new TossApiClient().confirmBrandPayPayment('pay_brandpay', 4000, 'order_123', 'user-123');
    expect(fetchMock).toHaveBeenCalledWith('https://api.tosspayments.com/v1/brandpay/payments/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from('test_gsk_widget:').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey: 'pay_brandpay', orderId: 'order_123', amount: 4000, customerKey: 'user-123' }),
    });
  });

  it('exchanges a BrandPay authorization code with the matching widget secret', async () => {
    process.env.TOSS_WIDGET_SECRET_KEY = 'test_gsk_widget';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ accessToken: 'brandpay_token' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await new TossApiClient().issueBrandPayAccessToken('auth_code', 'user-123');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://api.tosspayments.com/v1/brandpay/authorizations/access-token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from('test_gsk_widget:').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grantType: 'AuthorizationCode', code: 'auth_code', customerKey: 'user-123' }),
    });
  });
});
