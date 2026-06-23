import { NextResponse, type NextRequest } from 'next/server';

import { exchangeHandoffForTokens } from '@/lib/auth/oidc-client';
import { writeSessionCookies } from '@/lib/auth/session-cookies';

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
 * 토큰이 없거나 교환에 실패하면 기존 /auth/ensure (refresh → silent SSO) 폴백으로 떨어진다.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.nextUrl.origin;
  const redirectTo = sanitizeInternalRedirect(request.nextUrl.searchParams.get('redirect_to'));
  const handoffToken = request.nextUrl.searchParams.get('h');

  if (!handoffToken) {
    return ensureFallback(origin, redirectTo);
  }

  let tokens;
  try {
    tokens = await exchangeHandoffForTokens(handoffToken);
  } catch {
    // 핸드오프 토큰 만료/무효 → 기존 세션 복구 경로로.
    return ensureFallback(origin, redirectTo);
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

function sanitizeInternalRedirect(value: string | null): string {
  if (!value) return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  return value;
}
