jest.mock('@/lib/auth/oidc-client', () => ({ refreshTokens: jest.fn() }));
jest.mock('@/lib/auth/session-cookies', () => ({
  SESSION_COOKIE_NAMES: { ACCESS_TOKEN: 'wallet_at', REFRESH_TOKEN: 'wallet_rt' },
  backendAuthCookieFromToken: (token: string | undefined) => (token ? `accessToken=${token}` : ''),
  writeSessionCookies: jest.fn(),
}));

import { webcrypto } from 'node:crypto';
import { NextRequest } from 'next/server';
import { GET } from './route';

describe('BrandPay SDK authorization callback', () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    if (!global.crypto) Object.defineProperty(global, 'crypto', { value: webcrypto, configurable: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  function request() {
    return new NextRequest(
      'http://localhost:3200/api/toss/brandpay/authorize?code=test-code&customerKey=test-customer',
      {
        headers: { Cookie: 'wallet_brandpay_intent=pi_test123; wallet_at=session-token' },
      },
    );
  }

  it('finishes the SDK callback without redirecting to checkout or consuming its session', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = fetchMock;

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('location')).toBeNull();
    expect(response.cookies.get('wallet_brandpay_intent')).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/payment-intents/pi_test123/brandpay-authorize'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    );
  });

  it('returns token exchange failures to the SDK without loading another payment page', async () => {
    global.fetch = jest.fn().mockResolvedValue(Response.json({ error: 'NOT_FOUND_MERCHANT' }, { status: 400 }));

    const response = await GET(request());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'NOT_FOUND_MERCHANT' }));
    expect(response.headers.get('location')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reuses a hashed key on SDK retry and changes it for a different code', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = fetchMock;
    await GET(request());
    await GET(request());
    const differentCode = request();
    differentCode.nextUrl.searchParams.set('code', 'another-code');
    await GET(differentCode);
    const keys = fetchMock.mock.calls.map(([, init]) => init.headers['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[0]).toMatch(/^brandpay-authorize:[a-f0-9]{64}$/);
    expect(keys[0]).not.toContain('test-code');
  });
});
