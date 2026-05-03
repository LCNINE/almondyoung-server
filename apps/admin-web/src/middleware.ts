import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions } from 'jose';

const FIVE_MINUTES = 5 * 60 * 1000;
const REFRESH_MAX_AGE = 60 * 60 * 24 * 14; // 2 weeks — refresh 쿠키 갱신 시 유지

const ACCESS_TOKEN = 'accessToken';
const REFRESH_TOKEN = 'refreshToken';
const ID_TOKEN = 'idToken';

// admin-web 은 user-service IdP 의 OIDC RP. access_token 검증은 RS256 + JWKS 단일화.
// HS256 fallback / parent-domain 쿠키 / /auth/restore-token 호출은 모두 제거됨.
const OAUTH_JWKS_URL = process.env.OAUTH_JWKS_URL;
const OAUTH_ISSUER_URL = process.env.OAUTH_ISSUER_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;

if (!OAUTH_JWKS_URL || !OAUTH_ISSUER_URL || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET) {
  console.warn(
    '[middleware] OIDC env not fully configured: OAUTH_JWKS_URL, OAUTH_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET 필요',
  );
}

const JWKS = OAUTH_JWKS_URL ? createRemoteJWKSet(new URL(OAUTH_JWKS_URL)) : null;

const VERIFY_OPTS: JWTVerifyOptions = {
  audience: OIDC_CLIENT_ID,
  ...(OAUTH_ISSUER_URL ? { issuer: OAUTH_ISSUER_URL } : {}),
  algorithms: ['RS256'],
};

async function verifyAccessToken(token: string) {
  if (!JWKS) throw new Error('JWKS not configured');
  return jwtVerify(token, JWKS, VERIFY_OPTS);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 정적 파일 및 API 라우트는 미들웨어를 거치지 않음
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/public/') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // BYPASS_AUTH=true 환경변수로만 인증 우회 가능 (개발 환경에서 MSW 사용 시)
  if (process.env.BYPASS_AUTH === 'true') {
    return NextResponse.next();
  }

  // 공개 경로 (토큰 체크 안 함). /login 은 OIDC authorize 로 redirect, /auth/callback 은 code 교환.
  const publicPaths = ['/login', '/unauthorized', '/auth/callback'];
  const isPublicPath = publicPaths.some((path) => pathname.startsWith(path));
  if (isPublicPath) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN)?.value;
  const refreshToken = request.cookies.get(REFRESH_TOKEN)?.value;

  // 토큰이 둘 다 없으면 OIDC 로그인 시작 (자체 /login 으로 보냄 → 거기서 IdP 로 redirect)
  if (!accessToken && !refreshToken) {
    return redirectToLogin(request);
  }

  // accessToken 검증 및 선제적 갱신
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
        if (refreshed) {
          return setRefreshedTokenResponse(refreshed);
        }
      }
      return NextResponse.next();
    } catch {
      if (!refreshToken) {
        return redirectToLogin(request);
      }
      try {
        const refreshed = await refreshTokens(refreshToken);
        if (!refreshed) return redirectToLogin(request);
        try {
          await verifyAccessToken(refreshed.accessToken);
        } catch {
          console.error('재발급받은 토큰이 유효하지 않음');
          return redirectToLogin(request);
        }
        return setRefreshedTokenResponse(refreshed);
      } catch (fetchError) {
        console.error('토큰 재발급 중 에러:', fetchError);
        return redirectToLogin(request);
      }
    }
  }

  // accessToken 없고 refreshToken만 있는 경우
  if (refreshToken) {
    try {
      const refreshed = await refreshTokens(refreshToken);
      if (!refreshed) return redirectToLogin(request);
      try {
        await verifyAccessToken(refreshed.accessToken);
      } catch {
        return redirectToLogin(request);
      }
      return setRefreshedTokenResponse(refreshed);
    } catch {
      return redirectToLogin(request);
    }
  }

  return NextResponse.next();
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = new URL('/login', request.nextUrl.origin);
  url.searchParams.set('redirect_to', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

type RefreshResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

/**
 * user-service /oauth/token (refresh_token grant) 직접 호출.
 * Edge runtime 에서 실행되며 fetch 만 사용. 실패 시 null 반환 (로그인 redirect 유발).
 */
async function refreshTokens(refreshToken: string): Promise<RefreshResult | null> {
  if (!OAUTH_ISSUER_URL || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET) return null;

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OIDC_CLIENT_ID,
      client_secret: OIDC_CLIENT_SECRET,
    });

    const response = await fetch(`${OAUTH_ISSUER_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      console.error('refresh_token grant 실패:', response.status);
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
    console.error('refresh_token grant 예외:', e);
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
  // user-service 가 refresh 회전을 강제하므로 새 refresh_token 도 반드시 갱신해야 다음 호출이 reuse detection 에 안 걸림.
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
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};

// id_token 은 logout 시 id_token_hint 로 사용. middleware 에선 직접 검증하지 않으나
// 쿠키 이름 정의는 source-of-truth 차원에서 함께 둔다.
void ID_TOKEN;
