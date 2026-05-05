import { NextResponse } from 'next/server';

import { refreshTokens } from '@/lib/auth/oidc-client';
import {
  clearSessionCookiesOn,
  getRefreshToken,
  writeSessionCookies,
} from '@/lib/auth/session-cookies';

/**
 * CSR 용 토큰 갱신 엔드포인트.
 *
 * 브라우저가 refreshToken 쿠키와 함께 이 라우트를 호출하면, OIDC `/oauth/token`
 * (refresh_token grant) 으로 access/refresh 회전 후 host-only HttpOnly 쿠키로 set.
 * 실패 시 모든 세션 쿠키를 삭제해 클라이언트가 다음 401 에서 /login redirect 로 흐르게 한다.
 */
export async function POST(): Promise<NextResponse> {
  const refresh = await getRefreshToken();
  if (!refresh) {
    return new NextResponse(null, { status: 401 });
  }

  let tokens;
  try {
    tokens = await refreshTokens(refresh);
  } catch {
    const fail = new NextResponse(null, { status: 401 });
    clearSessionCookiesOn(fail.cookies);
    return fail;
  }

  const response = new NextResponse(null, { status: 204 });
  writeSessionCookies(response.cookies, tokens);
  return response;
}
