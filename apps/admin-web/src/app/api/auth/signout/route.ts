import { NextRequest, NextResponse } from 'next/server';

import { buildEndSessionUrl } from '@/lib/auth/oidc-client';
import { clearSessionCookiesOn } from '@/lib/auth/session-cookies';

/**
 * 로그아웃: admin-web 자체 세션 쿠키를 비우고, IdP `/oauth/end_session` 으로 redirect.
 * IdP 가 사용자 측 SSO 세션과 모든 OAuth refresh token 을 revoke 한 뒤
 * `post_logout_redirect_uri` 화이트리스트에 매칭되는 URL 로 다시 redirect 한다.
 *
 * 클라이언트가 fetch 로 호출하는 시나리오를 위해 200 + `{ redirectUrl }` 도 함께 반환 — 호출자가
 * 그 URL 로 location.assign 하면 된다.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const idToken = request.cookies.get('idToken')?.value ?? null;
  const redirectUrl = buildEndSessionUrl(idToken);

  const response = NextResponse.json({ redirectUrl }, { status: 200 });
  clearSessionCookiesOn(response.cookies);
  return response;
}

/**
 * GET 으로 진입하면 곧장 IdP end_session 으로 navigate. 사용자가 `/api/auth/signout` 링크를
 * 직접 누르거나 navigate 하는 시나리오 대응.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const idToken = request.cookies.get('idToken')?.value ?? null;
  const response = NextResponse.redirect(buildEndSessionUrl(idToken));
  clearSessionCookiesOn(response.cookies);
  return response;
}
