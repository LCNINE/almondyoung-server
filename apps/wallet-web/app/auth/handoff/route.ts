import { NextResponse, type NextRequest } from 'next/server';

import { selfOrigin } from '../../../lib/auth/access-token';
import { exchangeHandoffForTokens } from '../../../lib/auth/oidc-client';
import { sanitizeInternalRedirect } from '../../../lib/auth/internal-redirect';
import { clearSessionCookiesOn, writeSessionCookies } from '../../../lib/auth/session-cookies';

/**
 * storefront → wallet-web 결제 진입 핸드오프 착지점.
 *
 * storefront 가 인증된 고객에게 발급받은 단기 핸드오프 토큰(`h`)을 confidential client 인증과 함께
 * 교환해 wallet-web 자기 세션 쿠키를 발급한 뒤 원래 결제 경로로 1홉 복귀한다.
 *
 * 별도 서브도메인에서 OIDC silent-SSO / 부모도메인 쿠키 공유에 의존하던 기존 경로는 인앱브라우저·
 * iOS Safari(ITP) 에서 쿠키 격리/소실로 깨졌다. 핸드오프는 토큰을 first-party URL 로 전달하고
 * wallet-web 이 자기 호스트 쿠키를 직접 박으므로 그 환경에서도 동작한다.
 *
 * 토큰이 없으면 /auth/ensure (refresh → silent SSO) 로, 교환에 실패하면 세션을 비우고 /login 으로 보낸다.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = selfOrigin() ?? request.nextUrl.origin;
  const redirectTo = sanitizeInternalRedirect(request.nextUrl.searchParams.get('redirect_to'));
  const handoffToken = request.nextUrl.searchParams.get('h');

  if (!handoffToken) {
    return ensureFallback(origin, redirectTo);
  }

  let tokens;
  try {
    tokens = await exchangeHandoffForTokens(handoffToken);
  } catch {
    // 스토어프론트가 계정을 바꾼 뒤일 수 있어 남아 있는 wallet-web 세션(이전 계정일 수 있음)을 쓰지 않고
    // 비운 뒤 IdP 의 지금 계정으로 다시 로그인한다.
    const login = new URL('/login', origin);
    login.searchParams.set('redirect_to', redirectTo);
    const response = NextResponse.redirect(login);
    clearSessionCookiesOn(response.cookies);

    return response;
  }

  const response = NextResponse.redirect(new URL(redirectTo, origin));
  writeSessionCookies(response.cookies, tokens);
  return response;
}

function ensureFallback(origin: string, redirectTo: string): NextResponse {
  const ensure = new URL('/auth/ensure', origin);
  ensure.searchParams.set('redirect_to', redirectTo);
  return NextResponse.redirect(ensure);
}
