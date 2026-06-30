import { refreshTokens, type TokenSet } from '../../../lib/auth/oidc-client';
import {
  SESSION_COOKIE_NAMES,
  backendAuthCookieFromToken,
  writeSessionCookies,
} from '../../../lib/auth/session-cookies';
import { createWebLogger } from '@packages/web-observability';

// ponytail: payment-intent proxy 와 같은 cookie-forward + 401 one-shot refresh 패턴.
// 현금영수증도 "결제 후 화면에 머무는 동안 access token 만료" 시나리오가 동일해 재사용.

const logger = createWebLogger({
  component: 'wallet-web.cash-receipt-proxy',
  route: '/api/cash-receipts',
});

function getWalletApiUrl(): string {
  return process.env.WALLET_API_URL ?? process.env.NEXT_PUBLIC_WALLET_API_URL ?? 'http://localhost:3100';
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function cookieJar(headers: Headers) {
  return {
    set(
      name: string,
      value: string,
      options: { httpOnly?: boolean; secure?: boolean; sameSite?: 'lax' | 'strict' | 'none'; path?: string; maxAge?: number } = {},
    ): void {
      let cookie = `${name}=${value}`;
      if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
      cookie += `; Path=${options.path ?? '/'}`;
      if (options.httpOnly) cookie += '; HttpOnly';
      if (options.secure) cookie += '; Secure';
      if (options.sameSite) cookie += `; SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`;
      headers.append('Set-Cookie', cookie);
    },
  };
}

async function proxy(request: Request, method: 'GET' | 'POST', search = ''): Promise<Response> {
  const url = `${getWalletApiUrl()}/v1/cash-receipts${search}`;
  const body = method === 'POST' ? await request.text() : undefined;
  const rawCookie = request.headers.get('Cookie');

  const call = (cookie: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (cookie) headers.Cookie = cookie;
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    return fetch(url, { method, headers, body, cache: 'no-store' });
  };

  let upstream = await call(rawCookie);
  let refreshed: TokenSet | null = null;

  if (upstream.status === 401) {
    const refreshToken = readCookie(rawCookie, SESSION_COOKIE_NAMES.REFRESH_TOKEN);
    if (refreshToken) {
      try {
        refreshed = await refreshTokens(refreshToken);
        upstream = await call(backendAuthCookieFromToken(refreshed.accessToken));
      } catch {
        refreshed = null;
      }
    }
  }

  const responseBody = await upstream.text();
  const headers = new Headers();
  const contentType = upstream.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  if (refreshed) writeSessionCookies(cookieJar(headers), refreshed);

  if (upstream.status >= 500) {
    logger.error('wallet.cash_receipt.upstream_5xx', { attributes: { method, upstream_status: upstream.status } });
  }

  return new Response(responseBody || null, { status: upstream.status, headers });
}

export async function POST(request: Request): Promise<Response> {
  return proxy(request, 'POST');
}

export async function GET(request: Request): Promise<Response> {
  const intentId = new URL(request.url).searchParams.get('intentId') ?? '';
  return proxy(request, 'GET', `?intentId=${encodeURIComponent(intentId)}`);
}
