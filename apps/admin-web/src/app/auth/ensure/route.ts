import { NextResponse, type NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions } from 'jose';

import { refreshTokens } from '@/lib/auth/oidc-client';
import {
  SESSION_COOKIE_NAMES,
  clearSessionCookiesOn,
  writeSessionCookies,
} from '@/lib/auth/session-cookies';

/**
 * Route Handler 는 Node 런타임에서만 돈다. 미들웨어(Edge)가 refresh 를 못 하는 이유 —
 * Edge 엔 공유 락이 없어 한 페이지의 다수 동시 요청이 같은 refresh token 을 쓰면 user-service
 * reuse detection 이 세션을 무효화 — 를 회피하려고, refresh 는 전체 네비게이션당 1회만 들르는
 * 이 Node 라우트에서 수행한다.
 */
export const runtime = 'nodejs';

/**
 * 미들웨어가 access token 만료/부재를 감지했을 때(단, refresh token 은 존재) 들르는 갱신 지점.
 *
 * 기존엔 미들웨어가 곧바로 `/login` 으로 보내 전체 OIDC 왕복을 태웠고, admin-web `/login` 은
 * silent SSO(prompt=none)도 안 써서 매번 IdP hub(계정 리스트) → 비밀번호 재입력이 됐다. access
 * token TTL 이 15분이라 로그인 15분 뒤 전체 페이지 진입(새로고침/URL 직접/탭 재오픈)마다 재로그인.
 * (client.ts 의 Web Locks refresh 는 SPA 내부 fetch 만 커버하고 전체 네비게이션은 못 막는다.)
 *
 * 여기서 14일짜리 refresh token 으로 먼저 갱신 → IdP 왕복 없이 원래 경로로 1홉 복귀.
 * refresh token 까지 죽었을 때만 `/login` 으로 떨어뜨린다.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const redirectTo = sanitizeInternalRedirect(
    request.nextUrl.searchParams.get('redirect_to')
  );
  const origin = request.nextUrl.origin;

  const refresh = request.cookies.get(
    SESSION_COOKIE_NAMES.REFRESH_TOKEN
  )?.value;
  if (!refresh) {
    return redirectToLogin(origin, redirectTo);
  }

  let tokens;
  try {
    tokens = await refreshTokens(refresh);
  } catch {
    const fail = redirectToLogin(origin, redirectTo);
    clearSessionCookiesOn(fail.cookies);
    return fail;
  }

  // 갱신된 토큰이 미들웨어 검증을 통과하는지 확인 — 통과 못 하면 redirect_to 가 다시 미들웨어로
  // 튕겨 ensure↔page 루프가 되므로, 그 경우엔 /login 으로 보낸다 (방어적).
  if (!(await isVerifiable(tokens.accessToken))) {
    return redirectToLogin(origin, redirectTo);
  }

  const response = NextResponse.redirect(new URL(redirectTo, origin));
  writeSessionCookies(response.cookies, tokens);
  return response;
}

const OAUTH_JWKS_URL = process.env.OAUTH_JWKS_URL;
const OAUTH_ISSUER_URL = process.env.OAUTH_ISSUER_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;

const JWKS = OAUTH_JWKS_URL
  ? createRemoteJWKSet(new URL(OAUTH_JWKS_URL))
  : null;

const VERIFY_OPTS: JWTVerifyOptions = {
  audience: OIDC_CLIENT_ID,
  ...(OAUTH_ISSUER_URL ? { issuer: OAUTH_ISSUER_URL } : {}),
  algorithms: ['RS256'],
};

async function isVerifiable(token: string): Promise<boolean> {
  if (!JWKS) return false;
  try {
    await jwtVerify(token, JWKS, VERIFY_OPTS);
    return true;
  } catch {
    return false;
  }
}

function redirectToLogin(origin: string, redirectTo: string): NextResponse {
  const loginUrl = new URL('/login', origin);
  loginUrl.searchParams.set('redirect_to', redirectTo);
  return NextResponse.redirect(loginUrl);
}

function sanitizeInternalRedirect(value: string | null): string {
  if (!value) return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  return value;
}
