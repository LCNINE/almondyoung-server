import { NextRequest, NextResponse } from 'next/server';

import { buildEndSessionUrl } from '@/lib/auth/oidc-client';
import { clearSessionCookiesOn } from '@/lib/auth/session-cookies';

/**
 * 로그아웃: wallet-web 세션 쿠키를 비우고 IdP `/oauth/end_session` 으로 redirect.
 * IdP 가 사용자 측 SSO 세션과 OAuth refresh token 을 revoke 한 뒤 등록된
 * `post_logout_redirect_uri` 로 회신.
 *
 * fetch 로 호출하는 시나리오를 위해 POST 는 `{ redirectUrl }` 을 JSON 으로도 반환.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const idToken = request.cookies.get('idToken')?.value ?? null;
  const redirectUrl = buildEndSessionUrl(idToken);
  const response = NextResponse.json({ redirectUrl }, { status: 200 });
  clearSessionCookiesOn(response.cookies);
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const idToken = request.cookies.get('idToken')?.value ?? null;
  const response = NextResponse.redirect(buildEndSessionUrl(idToken));
  clearSessionCookiesOn(response.cookies);
  return response;
}
