import { NextRequest, NextResponse } from 'next/server';

import { refreshTokens } from '@/lib/auth/oidc-client';
import { writeSessionCookies } from '@/lib/auth/session-cookies';

/**
 * 클라이언트 axios interceptor 가 401 을 받으면 호출하는 토큰 갱신 endpoint.
 * 내부적으로 user-service /oauth/token (refresh_token grant) 을 호출해 새 access/refresh
 * token 을 받고, admin-web 자체 도메인 쿠키로 발급한다.
 *
 * 반환 본문은 기존 호환을 위해 `{ data: { accessToken } }` 형태 유지 — 클라이언트는 그저
 * 200 인지 401 인지만 보면 충분하지만, lib/api/client.ts 가 data.data.accessToken 을 읽으므로 보존.
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

  const response = NextResponse.json(
    { data: { accessToken: tokens.accessToken } },
    { status: 200 },
  );
  writeSessionCookies(response.cookies, tokens);
  return response;
}
