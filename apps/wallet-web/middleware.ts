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
  const loginUrl = new URL('/login', request.nextUrl.origin);
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
    algorithms: ['RS256'],
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
