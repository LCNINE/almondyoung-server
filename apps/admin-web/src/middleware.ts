import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions } from 'jose';

const ACCESS_TOKEN = 'accessToken';

const PUBLIC_PATHS = ['/login', '/unauthorized', '/auth/callback'];

// admin-web 은 user-service IdP 의 OIDC RP. access_token 검증은 RS256 + JWKS 단일화.
// HS256 fallback / parent-domain 쿠키 / /auth/restore-token 호출은 모두 제거됨.
const OAUTH_JWKS_URL = process.env.OAUTH_JWKS_URL;
const OAUTH_ISSUER_URL = process.env.OAUTH_ISSUER_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;

if (!OAUTH_JWKS_URL || !OAUTH_ISSUER_URL || !OIDC_CLIENT_ID) {
  console.warn(
    '[middleware] OIDC env not fully configured: OAUTH_JWKS_URL, OAUTH_ISSUER_URL, OIDC_CLIENT_ID 필요',
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

  // /login 은 OIDC authorize 로 redirect, /auth/callback 은 code 교환.
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN)?.value;
  if (!accessToken) {
    return redirectToLogin(request);
  }

  // accessToken 검증: 유효하면 통과, 만료/invalid 시 login redirect.
  // 미들웨어에서 refresh를 시도하지 않는다. Edge Runtime은 공유 락이 없어
  // 병렬 요청이 동시에 같은 refreshToken을 사용하면 user-service reuse detection이
  // 세션 전체를 무효화한다. refresh는 client.ts(Web Locks)에서만 수행한다.
  try {
    await verifyAccessToken(accessToken);
    return NextResponse.next();
  } catch {
    return redirectToLogin(request);
  }
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = new URL('/login', request.nextUrl.origin);
  url.searchParams.set('redirect_to', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
