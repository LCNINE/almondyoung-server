import { NextRequest, NextResponse } from 'next/server';

import { buildEndSessionUrl } from '@/lib/auth/oidc-client';
import { clearSessionCookiesOn } from '@/lib/auth/session-cookies';
import { oidcEndpointsOf, redirectOriginOf, siteOfRequest } from '@/lib/tenant-shell/site.server';

/**
 * 로그아웃: admin-web 자체 세션 쿠키를 비우고, IdP `/oauth/end_session` 으로 redirect.
 * IdP 가 사용자 측 SSO 세션과 모든 OAuth refresh token 을 revoke 한 뒤
 * `post_logout_redirect_uri` 화이트리스트에 매칭되는 URL 로 다시 redirect 한다.
 * end_session·돌아올 주소는 들어온 셸이 정한다 — 테넌트 도메인이면 그 테넌트의 auth-web 과 그 테넌트 주소.
 * 중립 화면(모르는 주소)은 쿠키만 비우고 IdP 로 보내지 않는다.
 *
 * 클라이언트가 fetch 로 호출하는 시나리오를 위해 200 + `{ redirectUrl }` 도 함께 반환 — 호출자가
 * 그 URL 로 location.assign 하면 된다.
 */
async function endSessionUrl(request: NextRequest): Promise<string> {
  const endpoints = oidcEndpointsOf(await siteOfRequest(request));
  if (!endpoints) return '/login';
  return buildEndSessionUrl(request.cookies.get('idToken')?.value ?? null, endpoints);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const redirectUrl = await endSessionUrl(request);

  const response = NextResponse.json({ redirectUrl }, { status: 200 });
  clearSessionCookiesOn(response.cookies);
  return response;
}

/**
 * GET 으로 진입하면 곧장 IdP end_session 으로 navigate. 사용자가 `/api/auth/signout` 링크를
 * 직접 누르거나 navigate 하는 시나리오 대응.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const site = await siteOfRequest(request);
  // 중립 화면(모르는 주소)은 상대 주소로 — 절대 주소를 만들면 기본(아몬드영) 주소로 보낸다.
  const response =
    site.kind === 'unavailable'
      ? new NextResponse(null, { status: 307, headers: { Location: '/login' } })
      : NextResponse.redirect(new URL(await endSessionUrl(request), redirectOriginOf(site, request)));
  clearSessionCookiesOn(response.cookies);
  return response;
}
