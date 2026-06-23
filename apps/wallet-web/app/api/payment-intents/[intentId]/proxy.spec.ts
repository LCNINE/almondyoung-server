jest.mock('../../../../lib/auth/oidc-client', () => ({
  refreshTokens: jest.fn(),
}));
jest.mock('../../../../lib/auth/session-cookies', () => ({
  SESSION_COOKIE_NAMES: {
    ACCESS_TOKEN: 'wallet_at',
    REFRESH_TOKEN: 'wallet_rt',
    ID_TOKEN: 'wallet_it',
    STATE_COOKIE: 'wallet_oidc_state',
  },
  backendAuthCookieFromToken: (token: string | null | undefined) => (token ? `accessToken=${token}` : ''),
  writeSessionCookies: jest.fn(),
}));

import { proxyPaymentIntentAction } from './proxy';
import { refreshTokens } from '../../../../lib/auth/oidc-client';
import { writeSessionCookies } from '../../../../lib/auth/session-cookies';

describe('payment intent proxy', () => {
  const originalFetch = global.fetch;
  const originalWalletApiUrl = process.env.WALLET_API_URL;
  const originalPublicWalletApiUrl = process.env.NEXT_PUBLIC_WALLET_API_URL;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.WALLET_API_URL = originalWalletApiUrl;
    process.env.NEXT_PUBLIC_WALLET_API_URL = originalPublicWalletApiUrl;
    jest.clearAllMocks();
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
    expect(refreshTokens).not.toHaveBeenCalled();
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

  it('refreshes the wallet-web session and retries when the wallet API returns 401', async () => {
    process.env.WALLET_API_URL = 'https://wallet-api.example.com';
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ id: 'pi_123', status: 'AWAITING_DEPOSIT' }));
    global.fetch = fetchMock as unknown as typeof fetch;
    (refreshTokens as jest.Mock).mockResolvedValue({
      accessToken: 'new_at',
      refreshToken: 'new_rt',
      idToken: 'new_it',
      expiresIn: 900,
    });

    const body = JSON.stringify({ paymentMethodId: 'pm_1' });
    const request = new Request('https://wallet-web.example.com/api/payment-intents/pi_123/confirm', {
      method: 'POST',
      headers: {
        Cookie: 'wallet_at=expired; wallet_rt=valid_refresh',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_abc',
      },
      body,
    });

    const response = await proxyPaymentIntentAction(request, 'pi_123', 'confirm');

    expect(response.status).toBe(200);
    expect(refreshTokens).toHaveBeenCalledWith('valid_refresh');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Retried with the refreshed access token and the SAME idempotency key.
    const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
    const retryHeaders = retryInit.headers as Record<string, string>;
    expect(retryHeaders.Cookie).toBe('accessToken=new_at');
    expect(retryHeaders['Idempotency-Key']).toBe('idem_abc');

    // Rotated session persisted back to the browser.
    expect(writeSessionCookies).toHaveBeenCalledTimes(1);
    expect((writeSessionCookies as jest.Mock).mock.calls[0][1]).toEqual(
      expect.objectContaining({ accessToken: 'new_at', refreshToken: 'new_rt' }),
    );
  });

  it('returns the original 401 when there is no refresh token to bounce with', async () => {
    process.env.WALLET_API_URL = 'https://wallet-api.example.com';
    const fetchMock = jest.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const request = new Request('https://wallet-web.example.com/api/payment-intents/pi_123/confirm', {
      method: 'POST',
      headers: { Cookie: 'wallet_at=expired', 'Content-Type': 'application/json' },
      body: '{}',
    });

    const response = await proxyPaymentIntentAction(request, 'pi_123', 'confirm');

    expect(response.status).toBe(401);
    expect(refreshTokens).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(writeSessionCookies).not.toHaveBeenCalled();
  });
});
