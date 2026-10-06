jest.mock('@/lib/auth/access-token', () => ({
  selfOrigin: () => 'http://172.30.1.13:3200',
  isAccessTokenUsable: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/lib/auth/oidc-client', () => ({
  exchangeCodeForTokens: jest.fn().mockResolvedValue({ accessToken: 'test-token' }),
  exchangeHandoffForTokens: jest.fn().mockResolvedValue({ accessToken: 'test-token' }),
  refreshTokens: jest.fn().mockResolvedValue({ accessToken: 'test-token' }),
  verifyIdToken: jest.fn(),
}));
jest.mock('@/lib/auth/session-cookies', () => ({
  SESSION_COOKIE_NAMES: { ACCESS_TOKEN: 'wallet_at', REFRESH_TOKEN: 'wallet_rt' },
  consumeStateCookie: jest.fn(),
  writeSessionCookies: jest.fn(),
  clearSessionCookiesOn: jest.fn(),
}));
jest.mock('@packages/web-observability', () => ({
  createWebLogger: () => ({ info: jest.fn(), error: jest.fn() }),
}));

import { NextRequest } from 'next/server';
import { consumeStateCookie } from '@/lib/auth/session-cookies';
import { GET as callback } from './callback/route';
import { GET as handoff } from './handoff/route';
import { GET as ensure } from './ensure/route';
import { POST as prepare } from '../api/toss/brandpay/prepare/route';

describe('mobile redirects with a localhost-normalized Next.js request', () => {
  const paymentPath = '/pay/test-intent?region=kr';

  it('returns to the public payment URL after OIDC login', async () => {
    jest.mocked(consumeStateCookie).mockResolvedValue({
      state: 'test-state',
      codeVerifier: 'test-verifier',
      nonce: 'test-nonce',
      redirectTo: paymentPath,
    });
    const response = await callback(
      new NextRequest('http://localhost:3200/auth/callback?code=test-code&state=test-state'),
    );
    expect(response.headers.get('location')).toBe(`http://172.30.1.13:3200${paymentPath}`);
  });

  it('keeps login failure recovery on the public host', async () => {
    jest.mocked(consumeStateCookie).mockResolvedValue(null);
    const response = await callback(new NextRequest('http://localhost:3200/auth/callback'));
    expect(new URL(response.headers.get('location')!).origin).toBe('http://172.30.1.13:3200');
  });

  it('returns to the public payment URL after storefront handoff', async () => {
    const response = await handoff(
      new NextRequest(
        `http://localhost:3200/auth/handoff?h=test-handoff&redirect_to=${encodeURIComponent(paymentPath)}`,
      ),
    );
    expect(response.headers.get('location')).toBe(`http://172.30.1.13:3200${paymentPath}`);
  });

  it('recovers an expired session on the public host', async () => {
    const response = await ensure(
      new NextRequest(`http://localhost:3200/auth/ensure?redirect_to=${encodeURIComponent(paymentPath)}`, {
        headers: { Cookie: 'wallet_rt=test-refresh' },
      }),
    );
    expect(response.headers.get('location')).toBe(`http://172.30.1.13:3200${paymentPath}`);
  });

  it('accepts the configured mobile origin and returns its BrandPay callback', async () => {
    const response = await prepare(
      new NextRequest('http://localhost:3200/api/toss/brandpay/prepare', {
        method: 'POST',
        headers: { Origin: 'http://172.30.1.13:3200', Cookie: 'wallet_at=test-token' },
        body: JSON.stringify({ intentId: 'test-intent' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      redirectUrl: 'http://172.30.1.13:3200/api/toss/brandpay/authorize',
    });
  });

  it('rejects requests from an unrelated origin', async () => {
    const response = await prepare(
      new NextRequest('http://localhost:3200/api/toss/brandpay/prepare', {
        method: 'POST',
        headers: { Origin: 'https://unrelated.example' },
      }),
    );
    expect(response.status).toBe(403);
  });
});
