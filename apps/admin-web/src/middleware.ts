import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions } from 'jose';

const ACCESS_TOKEN = 'accessToken';
const REFRESH_TOKEN = 'refreshToken';

const PUBLIC_PATHS = [
  '/login',
  '/unauthorized',
  '/auth/callback',
  '/auth/ensure',
];

// admin-web 은 user-service IdP 의 OIDC RP. access_token 검증은 RS256 + JWKS 단일화.
// HS256 fallback / parent-domain 쿠키 / /auth/restore-token 호출은 모두 제거됨.
const OAUTH_JWKS_URL = process.env.OAUTH_JWKS_URL;
const OAUTH_ISSUER_URL = process.env.OAUTH_ISSUER_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;

if (!OAUTH_JWKS_URL || !OAUTH_ISSUER_URL || !OIDC_CLIENT_ID) {
  console.warn(
    '[middleware] OIDC env not fully configured: OAUTH_JWKS_URL, OAUTH_ISSUER_URL, OIDC_CLIENT_ID 필요'
  );
}

const JWKS = OAUTH_JWKS_URL
  ? createRemoteJWKSet(new URL(OAUTH_JWKS_URL))
  : null;

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

  // /login 은 OIDC authorize 로 redirect, /auth/callback 은 code 교환.
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN)?.value;
  const hasRefreshToken = Boolean(request.cookies.get(REFRESH_TOKEN)?.value);
  if (!accessToken) {
    return bounce(request, hasRefreshToken);
  }

  // accessToken 검증: 유효하면 통과, 만료/invalid 시 갱신/로그인으로.
  // 미들웨어(Edge)에서 직접 refresh 하지 않는다 — 공유 락이 없어 한 페이지의 병렬 요청이 같은
  // refreshToken 을 동시에 쓰면 user-service reuse detection 이 세션을 무효화한다. 대신 전체
  // 네비게이션당 1회만 들르는 Node 라우트 `/auth/ensure` 로 보내 거기서 refresh 한다.
  // SPA 내부 fetch 의 refresh 는 여전히 client.ts(Web Locks)가 담당.
  try {
    await verifyAccessToken(accessToken);
    return NextResponse.next();
  } catch {
    return bounce(request, hasRefreshToken);
  }
}

/**
 * refresh token 이 있으면 `/auth/ensure` 로 보내 조용히 갱신 시도, 없으면 곧장 `/login`.
 * (refresh token 까지 없는 첫 진입은 ensure 를 들러도 어차피 /login 으로 떨어지므로 한 홉 절약.)
 */
function bounce(request: NextRequest, hasRefreshToken: boolean): NextResponse {
  const target = hasRefreshToken ? '/auth/ensure' : '/login';
  const url = new URL(target, request.nextUrl.origin);
  url.searchParams.set(
    'redirect_to',
    request.nextUrl.pathname + request.nextUrl.search
  );
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
