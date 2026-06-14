# Wallet Web Auth Bounce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop wallet-web from trying to repair expired JWTs itself during payment actions. When the wallet session is expired, send the browser through wallet-web `/login`, which starts the existing OIDC/auth-web flow and returns to the current payment page.

**Architecture:** Keep wallet-web cookies host-only. Do not reintroduce parent-domain wallet cookies. Route browser payment mutations through wallet-web same-origin API routes so the server can forward wallet-web host-only cookies to wallet API. Treat `401` from those payment mutations as "session expired", redirect the browser to `/login?redirect_to=<current pay URL>`, and let the existing OIDC callback restore wallet-web host-only cookies. For page navigations, middleware also bounces expired or nearly expired access tokens to `/login` instead of refreshing in middleware. Leave `app/api/auth/refresh/route.ts` in place for compatibility, but remove current wallet-web call paths to it.

**Tech Stack:** Next.js app router, TypeScript, Jest, jose JWT verification.

---

## Investigation Summary

- Issue #408 reports a red JWT token error in "well-web", which is almost certainly `wallet-web`, after time has passed on the payment page. The cancel/back path then appears broken because payment actions fail before the redirect flow can continue.
- `apps/wallet-web/lib/fetch-with-refresh.ts` currently retries `401` responses by calling same-origin `/api/auth/refresh`.
- That refresh only updates wallet-web host-only cookies. The client-side payment actions call `NEXT_PUBLIC_WALLET_API_URL` directly, so the retried cross-origin wallet API request still cannot see the refreshed wallet-web cookie.
- This explains why initial page load can work: server rendering forwards wallet-web cookies to wallet API. The bug appears after an already-open page performs client-side confirm/cancel with an expired token.
- The likely regression point is `70fdf8f4` (`[wallet-web] wallet-web이 OIDC RP로서 작동하도록 수정`, 2026-05-06), which intentionally moved wallet-web to host-only OIDC RP cookies. Earlier `31d6eb34` refreshed parent-domain cookies.
- `almondyoung-storefront` uses `/api/auth/restore-token` before falling back to login, but it owns parent-domain storefront cookies. Wallet-web intentionally should not copy that cookie-domain model.

---

## File Structure

Files to change:

```text
apps/wallet-web/lib/auth-expired.ts
apps/wallet-web/lib/auth-expired.spec.ts
apps/wallet-web/lib/fetch-with-refresh.ts
apps/wallet-web/lib/fetch-with-refresh.spec.ts
apps/wallet-web/lib/wallet-api.ts
apps/wallet-web/lib/wallet-api.spec.ts
apps/wallet-web/app/pay/[intentId]/pay-form.tsx
apps/wallet-web/app/api/payment-intents/[intentId]/proxy.ts
apps/wallet-web/app/api/payment-intents/[intentId]/proxy.spec.ts
apps/wallet-web/app/api/payment-intents/[intentId]/confirm/route.ts
apps/wallet-web/app/api/payment-intents/[intentId]/cancel/route.ts
apps/wallet-web/middleware.ts
```

Files intentionally left unchanged:

```text
apps/wallet-web/app/api/auth/refresh/route.ts
apps/wallet-web/app/login/route.ts
apps/wallet-web/app/auth/callback/route.ts
apps/wallet-web/lib/auth/session-cookies.ts
deployments/lcnine/services/infra/services.ts
```

---

## Task 1: Add a Small Session-Expired Helper

- [ ] Create `apps/wallet-web/lib/auth-expired.ts`:

```ts
export const WALLET_SESSION_EXPIRED_MESSAGE = '로그인이 만료되었습니다. 다시 로그인해주세요.';

export class WalletSessionExpiredError extends Error {
  readonly status = 401;

  constructor() {
    super(WALLET_SESSION_EXPIRED_MESSAGE);
    this.name = 'WalletSessionExpiredError';
  }
}

export function isWalletSessionExpiredError(error: unknown): error is WalletSessionExpiredError {
  return (
    error instanceof WalletSessionExpiredError ||
    (error instanceof Error && error.name === 'WalletSessionExpiredError')
  );
}

export function buildWalletLoginUrl(origin: string, pathname: string, search = ''): string {
  const redirectTo = `${pathname}${search}`;
  const loginUrl = new URL('/login', origin);
  loginUrl.searchParams.set('redirect_to', redirectTo);
  return loginUrl.toString();
}

export function redirectToWalletLogin(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.location.assign(buildWalletLoginUrl(window.location.origin, window.location.pathname, window.location.search));
}
```

- [ ] Create `apps/wallet-web/lib/auth-expired.spec.ts`:

```ts
import {
  WalletSessionExpiredError,
  buildWalletLoginUrl,
  isWalletSessionExpiredError,
} from './auth-expired';

describe('auth-expired helpers', () => {
  it('builds a wallet login URL that returns to the current path and query', () => {
    expect(buildWalletLoginUrl('https://wallet-web.example.com', '/pay/pi_123', '?region=kr')).toBe(
      'https://wallet-web.example.com/login?redirect_to=%2Fpay%2Fpi_123%3Fregion%3Dkr',
    );
  });

  it('recognizes wallet session expiration errors', () => {
    expect(isWalletSessionExpiredError(new WalletSessionExpiredError())).toBe(true);
    expect(isWalletSessionExpiredError(new Error('other'))).toBe(false);
  });
});
```

- [ ] Run the new helper test:

```bash
npm test -- apps/wallet-web/lib/auth-expired.spec.ts --runInBand
```

Expected result: the test fails before implementation if the helper file is absent, then passes after the helper is added.

---

## Task 2: Replace Refresh-on-401 with Auth-Bounce Semantics

- [ ] Replace the contents of `apps/wallet-web/lib/fetch-with-refresh.ts` with:

```ts
import { WalletSessionExpiredError } from './auth-expired';

export async function fetchWithAuthBounce(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);

  if (response.status === 401) {
    throw new WalletSessionExpiredError();
  }

  return response;
}
```

- [ ] Create `apps/wallet-web/lib/fetch-with-refresh.spec.ts`:

```ts
import { WalletSessionExpiredError } from './auth-expired';
import { fetchWithAuthBounce } from './fetch-with-refresh';

describe('fetchWithAuthBounce', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns non-401 responses without an auth refresh attempt', async () => {
    global.fetch = jest.fn(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;

    const response = await fetchWithAuthBounce('https://wallet-api.example.com/v1/payment-intents/pi_123/confirm', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws a session-expired error on 401 without calling /api/auth/refresh', async () => {
    global.fetch = jest.fn(async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;

    await expect(
      fetchWithAuthBounce('https://wallet-api.example.com/v1/payment-intents/pi_123/confirm', { method: 'POST' }),
    ).rejects.toBeInstanceOf(WalletSessionExpiredError);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalledWith('/api/auth/refresh', expect.anything());
  });
});
```

- [ ] Run the focused fetch test:

```bash
npm test -- apps/wallet-web/lib/fetch-with-refresh.spec.ts --runInBand
```

Expected result: no request to `/api/auth/refresh` is made.

---

## Task 3: Update Payment Actions to Use Same-Origin Proxy and Redirect on Expired Session

- [ ] Update `apps/wallet-web/lib/wallet-api.ts` imports and usages:

```ts
import { fetchWithAuthBounce } from './fetch-with-refresh';

function paymentIntentRoute(intentId: string, action: 'confirm' | 'cancel'): string {
  return `/api/payment-intents/${encodeURIComponent(intentId)}/${action}`;
}
```

Replace the two payment mutation calls:

```ts
const response = await fetchWithAuthBounce(paymentIntentRoute(intentId, 'confirm'), {
```

```ts
const response = await fetchWithAuthBounce(paymentIntentRoute(intentId, 'cancel'), {
```

- [ ] Add wallet-web same-origin payment proxy routes:

```text
apps/wallet-web/app/api/payment-intents/[intentId]/proxy.ts
apps/wallet-web/app/api/payment-intents/[intentId]/confirm/route.ts
apps/wallet-web/app/api/payment-intents/[intentId]/cancel/route.ts
```

The proxy must forward the incoming `Cookie` header and `Idempotency-Key` to:

```text
${WALLET_API_URL}/v1/payment-intents/${intentId}/confirm
${WALLET_API_URL}/v1/payment-intents/${intentId}/cancel
```

This is required because wallet-web OIDC cookies are host-only; after an auth-web bounce, browser-side direct calls to the wallet API domain still cannot see wallet-web cookies.

- [ ] Update `apps/wallet-web/app/pay/[intentId]/pay-form.tsx` imports:

```tsx
import { isWalletSessionExpiredError, redirectToWalletLogin } from '@/lib/auth-expired';
```

- [ ] In both `handleConfirm` and `handleCancel`, handle the new error before displaying the destructive alert:

```tsx
    } catch (err) {
      if (isWalletSessionExpiredError(err)) {
        redirectToWalletLogin();
        return;
      }

      setError(err instanceof Error ? err.message : '결제에 실패했습니다.');
    } finally {
      setLoading(false);
    }
```

For the cancel handler, keep the existing cancel fallback text:

```tsx
    } catch (err) {
      if (isWalletSessionExpiredError(err)) {
        redirectToWalletLogin();
        return;
      }

      setError(err instanceof Error ? err.message : '결제 취소에 실패했습니다.');
    } finally {
      setLoading(false);
    }
```

- [ ] Run the focused tests together:

```bash
npm test -- apps/wallet-web/lib/auth-expired.spec.ts apps/wallet-web/lib/fetch-with-refresh.spec.ts apps/wallet-web/lib/wallet-api.spec.ts --runInBand
npm test -- --runTestsByPath 'apps/wallet-web/app/api/payment-intents/[intentId]/proxy.spec.ts' --runInBand
```

Expected result: all focused tests pass.

---

## Task 4: Stop Middleware from Refreshing Expired Wallet Tokens

- [ ] Replace `apps/wallet-web/middleware.ts` with this shape, preserving the existing matcher:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const FIVE_MINUTES = 5 * 60 * 1000;

const ACCESS_TOKEN = 'accessToken';
const OAUTH_JWKS_URL = process.env.OAUTH_JWKS_URL || process.env.NEXT_PUBLIC_OAUTH_JWKS_URL;
const OIDC_ISSUER_URL = process.env.OIDC_ISSUER_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;

const JWKS = OAUTH_JWKS_URL ? createRemoteJWKSet(new URL(OAUTH_JWKS_URL)) : null;

if (!OAUTH_JWKS_URL || !OIDC_ISSUER_URL || !OIDC_CLIENT_ID) {
  console.warn('[wallet-web] OIDC middleware env is incomplete; protected routes will redirect to login.');
}

function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect_to', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

async function verifyAccessToken(token: string) {
  if (!JWKS || !OIDC_ISSUER_URL || !OIDC_CLIENT_ID) {
    throw new Error('OIDC middleware env is incomplete');
  }

  return jwtVerify(token, JWKS, {
    issuer: OIDC_ISSUER_URL,
    audience: OIDC_CLIENT_ID,
  });
}

function isNearExpiry(exp?: number): boolean {
  if (!exp) {
    return true;
  }

  return exp * 1000 - Date.now() < FIVE_MINUTES;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith('/api/');
  const accessToken = request.cookies.get(ACCESS_TOKEN)?.value;

  if (!accessToken) {
    return isApiRoute ? NextResponse.next() : redirectToLogin(request);
  }

  try {
    const { payload } = await verifyAccessToken(accessToken);

    if (isNearExpiry(payload.exp)) {
      return isApiRoute ? NextResponse.next() : redirectToLogin(request);
    }

    return NextResponse.next();
  } catch {
    return isApiRoute ? NextResponse.next() : redirectToLogin(request);
  }
}

export const config = {
  matcher: ['/pay/:path*', '/api/billing/:path*'],
};
```

- [ ] Confirm no remaining wallet-web caller depends on the direct refresh path:

```bash
rg "fetchWithRefresh|/api/auth/refresh|refreshTokens\\(" apps/wallet-web
```

Expected result: `app/api/auth/refresh/route.ts` may still define the compatibility endpoint, but payment code and middleware should no longer call it.

---

## Task 5: Verification

- [ ] Run the focused Jest tests:

```bash
npm test -- apps/wallet-web/lib/auth-expired.spec.ts apps/wallet-web/lib/fetch-with-refresh.spec.ts apps/wallet-web/lib/wallet-api.spec.ts --runInBand
npm test -- --runTestsByPath 'apps/wallet-web/app/api/payment-intents/[intentId]/proxy.spec.ts' --runInBand
```

- [ ] Run wallet-web lint:

```bash
cd apps/wallet-web && npm run lint
```

- [ ] Run wallet-web build with local dummy auth configuration if the shell does not already provide wallet-web env:

```bash
cd apps/wallet-web && OIDC_ISSUER_URL=http://localhost:3030 OIDC_AUTHORIZATION_URL=http://localhost:8002/oauth/authorize OIDC_TOKEN_URL=http://localhost:8002/oauth/token OIDC_CLIENT_ID=wallet-web OIDC_CLIENT_SECRET=test OIDC_REDIRECT_URI=http://localhost:3000/auth/callback OIDC_POST_LOGOUT_REDIRECT_URI=http://localhost:3000 OAUTH_JWKS_URL=http://localhost:3030/.well-known/jwks.json NEXT_PUBLIC_WALLET_API_URL=http://localhost:3100 WALLET_API_URL=http://localhost:3100 WALLET_API_KEY=test TOSS_CLIENT_KEY=test npm run build
```

- [ ] Manual scenario:

```text
1. Open a valid /pay/<intentId> page.
2. Let the wallet accessToken expire or force a wallet API 401 for confirm/cancel.
3. Click confirm or cancel.
4. Browser navigates to /login?redirect_to=/pay/<intentId>...
5. If auth-web has an active session, OIDC returns to the same payment page.
6. If auth-web has no active session, user sees the normal login flow.
7. After returning, confirm/cancel goes through wallet-web `/api/payment-intents/...`, which forwards the fresh host-only cookie to wallet API.
8. The red raw JWT/cookie error is not shown for the expired-session path.
```

---

## Rollback Plan

- Revert the changes to `apps/wallet-web/lib/fetch-with-refresh.ts`, `apps/wallet-web/lib/wallet-api.ts`, `apps/wallet-web/app/pay/[intentId]/pay-form.tsx`, and `apps/wallet-web/middleware.ts`.
- Remove the payment proxy routes, the focused specs, and `apps/wallet-web/lib/auth-expired.ts`.
- The existing `/api/auth/refresh` route remains available, so rollback does not require restoring that route.
