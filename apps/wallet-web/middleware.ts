import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions } from 'jose';

const FIVE_MINUTES = 5 * 60 * 1000;
const REFRESH_MAX_AGE = 60 * 60 * 24 * 14; // 2 weeks

const ACCESS_TOKEN = 'accessToken';
const REFRESH_TOKEN = 'refreshToken';

// wallet-web 은 user-service IdP 의 OIDC RP. accessToken 검증은 RS256 + JWKS.
const OAUTH_JWKS_URL = process.env.OAUTH_JWKS_URL;
const OIDC_ISSUER_URL = process.env.OIDC_ISSUER_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;

if (!OAUTH_JWKS_URL || !OIDC_ISSUER_URL || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET) {
  console.warn(
    '[middleware] OIDC env not fully configured: OAUTH_JWKS_URL, OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET 필요',
  );
}

const JWKS = OAUTH_JWKS_URL ? createRemoteJWKSet(new URL(OAUTH_JWKS_URL)) : null;

const VERIFY_OPTS: JWTVerifyOptions = {
  audience: OIDC_CLIENT_ID,
  ...(OIDC_ISSUER_URL ? { issuer: OIDC_ISSUER_URL } : {}),
  algorithms: ['RS256'],
};

async function verifyAccessToken(token: string) {
  if (!JWKS) throw new Error('JWKS not configured');
  return jwtVerify(token, JWKS, VERIFY_OPTS);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /pay/* 는 페이지 라우트 — 미인증이면 /login 으로 redirect (silent SSO 시도).
  // /api/billing/* 는 API 라우트 — 미인증이면 그냥 통과시켜 라우트가 401 을 반환하게 한다.
  const isApiRoute = pathname.startsWith('/api/');

  const accessToken = request.cookies.get(ACCESS_TOKEN)?.value;
  const refreshToken = request.cookies.get(REFRESH_TOKEN)?.value;

  if (!accessToken && !refreshToken) {
    return isApiRoute ? NextResponse.next() : redirectToLogin(request);
  }

  if (accessToken) {
    try {
      const { payload } = await verifyAccessToken(accessToken);
      const expiresAt = (payload.exp ?? 0) * 1000;
      const needsProactiveRefresh = expiresAt - Date.now() < FIVE_MINUTES;

      if (!needsProactiveRefresh) {
        return NextResponse.next();
      }

      if (refreshToken) {
        const refreshed = await refreshTokens(refreshToken);
        if (refreshed) return setRefreshedTokenResponse(refreshed);
      }
      return NextResponse.next();
    } catch {
      if (!refreshToken) {
        return isApiRoute ? NextResponse.next() : redirectToLogin(request);
      }
      try {
        const refreshed = await refreshTokens(refreshToken);
        if (!refreshed) {
          return isApiRoute ? NextResponse.next() : redirectToLogin(request);
        }
        try {
          await verifyAccessToken(refreshed.accessToken);
        } catch {
          console.error('[middleware] refreshed access token verify failed');
          return isApiRoute ? NextResponse.next() : redirectToLogin(request);
        }
        return setRefreshedTokenResponse(refreshed);
      } catch (e) {
        console.error('[middleware] refresh exception', e);
        return isApiRoute ? NextResponse.next() : redirectToLogin(request);
      }
    }
  }

  // accessToken 없고 refreshToken 만 있는 경우.
  if (refreshToken) {
    try {
      const refreshed = await refreshTokens(refreshToken);
      if (!refreshed) {
        return isApiRoute ? NextResponse.next() : redirectToLogin(request);
      }
      try {
        await verifyAccessToken(refreshed.accessToken);
      } catch {
        return isApiRoute ? NextResponse.next() : redirectToLogin(request);
      }
      return setRefreshedTokenResponse(refreshed);
    } catch {
      return isApiRoute ? NextResponse.next() : redirectToLogin(request);
    }
  }

  return NextResponse.next();
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = new URL('/login', request.nextUrl.origin);
  url.searchParams.set('redirect_to', request.nextUrl.pathname + request.nextUrl.search);
  // prompt 미지정 → /login 의 default 인 prompt=none (silent SSO 시도).
  return NextResponse.redirect(url);
}

type RefreshResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

/**
 * user-service /oauth/token (refresh_token grant) 직접 호출. Edge runtime 에서 fetch 만 사용.
 * 회전 (rotation) 강제 — 응답의 새 refresh_token 도 반드시 갱신해야 reuse detection 미발동.
 */
async function refreshTokens(refreshToken: string): Promise<RefreshResult | null> {
  if (!OIDC_ISSUER_URL || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET) return null;

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OIDC_CLIENT_ID,
      client_secret: OIDC_CLIENT_SECRET,
    });

    const response = await fetch(`${OIDC_ISSUER_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      console.error('[middleware] refresh_token grant failed:', response.status);
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  } catch (e) {
    console.error('[middleware] refresh_token exception:', e);
    return null;
  }
}

function setRefreshedTokenResponse(refreshed: RefreshResult): NextResponse {
  const response = NextResponse.next();
  const isProd = process.env.NODE_ENV === 'production';
  const cookieOpts = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
  };
  response.cookies.set(ACCESS_TOKEN, refreshed.accessToken, {
    ...cookieOpts,
    maxAge: refreshed.expiresIn,
  });
  response.cookies.set(REFRESH_TOKEN, refreshed.refreshToken, {
    ...cookieOpts,
    maxAge: REFRESH_MAX_AGE,
  });
  return response;
}

export const config = {
  matcher: ['/pay/:path*', '/api/billing/:path*'],
};
