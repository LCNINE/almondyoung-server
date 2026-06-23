import { refreshTokens, type TokenSet } from '../../../../lib/auth/oidc-client';
import {
  SESSION_COOKIE_NAMES,
  backendAuthCookieFromToken,
  writeSessionCookies,
} from '../../../../lib/auth/session-cookies';
import { createWebLogger } from '@packages/web-observability';

type PaymentIntentAction = 'confirm' | 'cancel' | 'abandon';

const logger = createWebLogger({
  component: 'wallet-web.payment-intent-proxy',
  route: '/api/payment-intents/[intentId]/[action]',
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

/**
 * Adapter exposing the `set(name, value, options)` shape that {@link writeSessionCookies}
 * expects, backed by a plain {@link Headers}. Lets us reuse the single source of truth for
 * session cookie attributes (httpOnly/secure/sameSite/maxAge) without depending on NextResponse.
 */
function cookieJar(headers: Headers) {
  return {
    set(
      name: string,
      value: string,
      options: {
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: 'lax' | 'strict' | 'none';
        path?: string;
        maxAge?: number;
      } = {},
    ): void {
      let cookie = `${name}=${value}`;
      if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
      cookie += `; Path=${options.path ?? '/'}`;
      if (options.httpOnly) cookie += '; HttpOnly';
      if (options.secure) cookie += '; Secure';
      if (options.sameSite) {
        cookie += `; SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`;
      }
      headers.append('Set-Cookie', cookie);
    },
  };
}

export async function proxyPaymentIntentAction(
  request: Request,
  intentId: string,
  action: PaymentIntentAction,
): Promise<Response> {
  const includeBody = action === 'confirm';
  const body = includeBody ? await request.text() : undefined;
  const url = `${getWalletApiUrl()}/v1/payment-intents/${encodeURIComponent(intentId)}/${action}`;

  // The same Idempotency-Key MUST be reused across the refresh-retry so the wallet never
  // double-processes a confirm.
  const idempotencyKey = request.headers.get('Idempotency-Key') ?? crypto.randomUUID();
  const contentType = request.headers.get('Content-Type') ?? 'application/json';
  const rawCookie = request.headers.get('Cookie');

  const callUpstream = (cookie: string | null): Promise<Response> => {
    const headers: Record<string, string> = { 'Idempotency-Key': idempotencyKey };
    if (cookie) headers.Cookie = cookie;
    if (includeBody) headers['Content-Type'] = contentType;
    return fetch(url, { method: 'POST', headers, body, cache: 'no-store' });
  };

  // 1st attempt: forward the browser cookies as-is (unchanged behaviour).
  let upstream = await callUpstream(rawCookie);
  let refreshed: TokenSet | null = null;

  // On auth failure, do a one-shot refresh with wallet-web's refresh token and retry.
  // This rescues sessions whose short-lived access token expired while the customer lingered
  // on the payment screen — the dominant "결제창이 안 넘어가요" / 401 "No auth token" failure.
  // (In-app browsers that drop cookies entirely have no refresh token here and still 401;
  // those need the same-origin / token-handoff fix.)
  if (upstream.status === 401) {
    const refreshToken = readCookie(rawCookie, SESSION_COOKIE_NAMES.REFRESH_TOKEN);
    if (refreshToken) {
      try {
        refreshed = await refreshTokens(refreshToken);
        upstream = await callUpstream(backendAuthCookieFromToken(refreshed.accessToken));
      } catch {
        // Refresh token is dead too — fall through with the original 401 so the client can
        // bounce to /auth/ensure on the next navigation.
        refreshed = null;
      }
    }
    logger.warn('wallet.payment_intent.auth_401', {
      attributes: {
        action,
        intent_id: intentId,
        user_agent: request.headers.get('User-Agent') ?? null,
        had_refresh_token: Boolean(refreshToken),
        refresh_attempted: Boolean(refreshToken),
        rescued: Boolean(refreshed && upstream.status < 400),
        final_status: upstream.status,
      },
    });
  }

  const responseBody = await upstream.text();
  const headers = new Headers();
  const upstreamContentType = upstream.headers.get('Content-Type');
  if (upstreamContentType) {
    headers.set('Content-Type', upstreamContentType);
  }

  // Persist the rotated session so the browser keeps the refreshed token for later calls.
  if (refreshed) {
    writeSessionCookies(cookieJar(headers), refreshed);
  }

  if (upstream.status >= 500) {
    logger.error('wallet.payment_intent.upstream_5xx', {
      attributes: {
        action,
        intent_id: intentId,
        upstream_status: upstream.status,
      },
    });
  }

  return new Response(responseBody || null, {
    status: upstream.status,
    headers,
  });
}
