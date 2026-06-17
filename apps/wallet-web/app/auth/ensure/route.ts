import { NextResponse, type NextRequest } from 'next/server';

import { isAccessTokenUsable } from '@/lib/auth/access-token';
import { refreshTokens } from '@/lib/auth/oidc-client';
import { SESSION_COOKIE_NAMES, clearSessionCookiesOn, writeSessionCookies } from '@/lib/auth/session-cookies';

/**
 * 보호된 page 의 세션 가드가 access token 을 못 쓸 때(만료/만료임박) 들르는 Node Route Handler.
 *
 * 기존엔 page 가드가 곧바로 `/login` 으로 보내 매번 전체 OIDC silent-SSO 왕복
 * (`/login → auth-web/oauth/authorize → /auth/callback → 원래 page`) 을 탔다. access token TTL
 * 이 15분이라 로그인 10분 뒤부터는 페이지 진입마다 이 왕복이 돌았고, WebKit(Safari·iOS) 은 그
 * 다단계 redirect 중 IdP 세션 쿠키 소실/쿠키 commit 타이밍 때문에 "너무 많은 리디렉션" 으로
 * 루프에 빠졌다 (Chrome 은 세션이 질겨 조용히 통과).
 *
 * 여기서 14일짜리 refresh token 으로 먼저 갱신을 시도한다 — 성공하면 IdP 왕복 없이 1홉으로
 * 원래 page 로 복귀(Route Handler 라 쿠키 회전 가능). refresh token 까지 죽었을 때만 `/login`
 * 으로 떨어뜨려 silent SSO 를 태운다.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const redirectTo = sanitizeInternalRedirect(request.nextUrl.searchParams.get('redirect_to'));
  const origin = request.nextUrl.origin;

  const refresh = request.cookies.get(SESSION_COOKIE_NAMES.REFRESH_TOKEN)?.value;
  if (!refresh) {
    return redirectToLogin(origin, redirectTo);
  }

  let tokens;
  try {
    tokens = await refreshTokens(refresh);
  } catch {
    // refresh token 도 죽음 → 세션 쿠키 정리 후 silent SSO 로.
    const fail = redirectToLogin(origin, redirectTo);
    clearSessionCookiesOn(fail.cookies);
    return fail;
  }

  // 갱신된 토큰이 정말 가드를 통과하는지 확인 — 통과 못 하면 redirect_to 가 다시 이리로 튕겨
  // ensure→page→ensure 루프가 되므로, 그 경우엔 /login 으로 보낸다 (방어적).
  if (!(await isAccessTokenUsable(tokens.accessToken))) {
    return redirectToLogin(origin, redirectTo);
  }

  const response = NextResponse.redirect(new URL(redirectTo, origin));
  writeSessionCookies(response.cookies, tokens);
  return response;
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
