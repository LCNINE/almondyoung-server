jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('../../lib/auth/access-token', () => ({
  selfOrigin: () => 'http://172.30.1.13:3200',
  isAccessTokenUsable: jest.fn().mockResolvedValue(true),
  verifiedAccessTokenIdentity: jest.fn().mockResolvedValue({ sub: 'user-b', loginId: 'userb', name: 'B' }),
}));
jest.mock('../../lib/auth/oidc-client', () => ({
  createAuthorizationRequest: jest.fn((redirectTo: string, prompt: string, base: string) => ({
    authorizeUrl: `${base}?state=s1&code_challenge=c1`,
    stateRecord: { state: 's1', nonce: 'n1', codeVerifier: 'v1', redirectTo, prompt },
  })),
  exchangeCodeForTokens: jest.fn().mockResolvedValue({ accessToken: 'test-token' }),
  refreshTokens: jest.fn().mockResolvedValue({ accessToken: 'test-token' }),
  verifyIdToken: jest.fn(),
}));
jest.mock('../../lib/auth/session-cookies', () => ({
  SESSION_COOKIE_NAMES: { ACCESS_TOKEN: 'wallet_at', REFRESH_TOKEN: 'wallet_rt' },
  consumeStateCookie: jest.fn(),
  writeSessionCookies: jest.fn(),
  writeStateCookie: jest.fn(),
  clearSessionCookiesOn: jest.fn(),
}));
jest.mock('@packages/web-observability', () => ({
  createWebLogger: () => ({ info: jest.fn(), error: jest.fn() }),
}));

import { NextRequest } from 'next/server';
import { refreshTokens } from '../../lib/auth/oidc-client';
import { consumeStateCookie, writeSessionCookies, writeStateCookie } from '../../lib/auth/session-cookies';
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

  it('sends the handoff to the storefront with this browser state, never reusing the leftover session', async () => {
    process.env.STOREFRONT_ORIGIN = 'https://shop.example';

    const response = handoff(
      new NextRequest(`http://localhost:3200/auth/handoff?redirect_to=${encodeURIComponent(paymentPath)}`, {
        headers: { Cookie: 'wallet_rt=previous-account-refresh' },
      }),
    );

    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://shop.example/api/wallet-handoff');
    expect(writeStateCookie).toHaveBeenCalledWith(
      response.cookies,
      expect.objectContaining({ state: 's1', redirectTo: paymentPath, prompt: 'none' }),
    );
    expect(refreshTokens).not.toHaveBeenCalled();
    delete process.env.STOREFRONT_ORIGIN;
  });

  it('ignores a legacy handoff token in the URL', () => {
    process.env.STOREFRONT_ORIGIN = 'https://shop.example';
    jest.mocked(writeSessionCookies).mockClear();

    const response = handoff(
      new NextRequest(`http://localhost:3200/auth/handoff?h=attacker-token&redirect_to=${encodeURIComponent(paymentPath)}`),
    );

    expect(new URL(response.headers.get('location')!).pathname).toBe('/api/wallet-handoff');
    expect(writeSessionCookies).not.toHaveBeenCalled();
    delete process.env.STOREFRONT_ORIGIN;
  });

  it('issues an entry ticket on login and marks billing-change with it', async () => {
    jest.mocked(consumeStateCookie).mockResolvedValue({
      state: 'test-state',
      codeVerifier: 'test-verifier',
      nonce: 'test-nonce',
      redirectTo: '/billing-change?returnUrl=x',
    });

    const response = await callback(
      new NextRequest('http://localhost:3200/auth/callback?code=test-code&state=test-state'),
    );

    const location = new URL(response.headers.get('location')!);
    const entryId = location.searchParams.get('entry');
    expect(location.pathname).toBe('/billing-change');
    expect(entryId).toBeTruthy();
    const ticketCookie = response.cookies.get('wallet_entry')?.value;
    expect(JSON.parse(Buffer.from(ticketCookie!, 'base64url').toString('utf8'))).toMatchObject({
      id: entryId,
      sub: 'user-b',
    });
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
