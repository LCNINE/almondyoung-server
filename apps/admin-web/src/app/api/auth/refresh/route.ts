import { NextRequest, NextResponse } from 'next/server';

import { refreshTokens } from '@/lib/auth/oidc-client';
import { writeSessionCookies } from '@/lib/auth/session-cookies';

/**
 * 클라이언트 axios interceptor 가 401 을 받으면 호출하는 토큰 갱신 endpoint.
 * 내부적으로 user-service /oauth/token (refresh_token grant) 을 호출해 새 access/refresh
 * token 을 받고, admin-web 자체 도메인 쿠키로 발급한다.
 *
 * **본문에 토큰을 싣지 않는다 (204).** 세션 쿠키는 httpOnly 라 페이지 스크립트가 읽을 수
 * 없는데, 여기서 accessToken 을 본문으로 돌려주면 같은 origin 의 아무 스크립트나 이 라우트를
 * 한 번 때려 평문 토큰을 손에 넣는다 — XSS 가 "피해자 브라우저 안에서의 행동"에 그치지 않고
 * 토큰 반출로 번진다. 호출부 셋(lib/api/client.ts, lib/api/fetch-with-refresh.ts,
 * account/change-password/page.tsx)은 전부 `response.ok` 만 보므로 본문이 필요 없다.
 * wallet-web 의 같은 라우트도 204 다.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get('refreshToken')?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  let tokens;
  try {
    tokens = await refreshTokens(refreshToken);
  } catch (e) {
    console.error('[api/auth/refresh] grant failed', e);
    return NextResponse.json({ error: 'refresh failed' }, { status: 401 });
  }

  const response = new NextResponse(null, { status: 204 });
  writeSessionCookies(response.cookies, tokens);
  return response;
}
