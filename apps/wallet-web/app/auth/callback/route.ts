import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { consumeStateCookie, writeSessionCookies } from '@/lib/auth/session-cookies';
import { exchangeCodeForTokens, verifyIdToken, type OidcStateRecord } from '@/lib/auth/oidc-client';
import { createWebLogger } from '@packages/web-observability';

const logger = createWebLogger({
  component: 'wallet-web.auth-callback',
  route: '/auth/callback',
});

/**
 * IdP 가 사용자 동의/로그인 완료 후 redirect 로 진입하는 callback 라우트.
 *
 * 정상 흐름:
 *   1. `oidc_state` 쿠키에서 state/nonce/codeVerifier/redirectTo 복원 (1회용 — consume 시 삭제)
 *   2. 쿼리스트링 state 와 쿠키 state 대조 (CSRF)
 *   3. /oauth/token 에 code + verifier 로 토큰 교환
 *   4. id_token 의 nonce 가 쿠키에 저장된 nonce 와 일치하는지 + 서명/iss/aud 검증
 *   5. accessToken/refreshToken/idToken 을 자체 도메인 host-only HttpOnly 쿠키로 발급
 *   6. redirectTo 로 302
 *
 * 예외 — `error=login_required` (prompt=none 으로 시도했는데 IdP 활성 세션이 없는 경우):
 *   wallet-web 은 silent SSO 우선이므로 default 가 prompt=none. 세션이 없으면 IdP 가 OIDC error
 *   응답으로 회신하므로, 자동으로 `/login?redirect_to=...&prompt=` (prompt 빈 문자열 = 미전송)
 *   로 재진입해 hub 가 뜨도록 fallback 한다.
 *
 * 그 외 에러: /login?error=... 로 떨어뜨려 사용자가 재시도할 수 있게 한다.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const stateFromQuery = url.searchParams.get('state');
  const errorFromIdp = url.searchParams.get('error');

  // state cookie 는 어떤 분기든 1회 소비해 stale 상태 누적 방지.
  const stateRecord = await consumeStateCookie<OidcStateRecord>();

  if (errorFromIdp) {
    // prompt=none 으로 시도한 silent SSO 가 활성 세션 없음으로 실패한 경우 → interactive fallback.
    if (errorFromIdp === 'login_required' && stateRecord?.prompt === 'none') {
      logger.info('wallet.auth_callback.silent_sso_login_required', {
        attributes: {
          has_redirect_to: Boolean(stateRecord.redirectTo),
        },
      });
      const dest = new URL('/login', request.nextUrl.origin);
      if (stateRecord.redirectTo) dest.searchParams.set('redirect_to', stateRecord.redirectTo);
      // 빈 문자열로 명시 — login page 가 이를 "prompt 미전송" 으로 해석.
      dest.searchParams.set('prompt', '');
      return NextResponse.redirect(dest);
    }
    return failRedirect(request, errorFromIdp);
  }

  if (!code || !stateFromQuery) {
    return failRedirect(request, 'missing_code_or_state');
  }
  if (!stateRecord) {
    return failRedirect(request, 'state_cookie_missing');
  }
  if (stateRecord.state !== stateFromQuery) {
    return failRedirect(request, 'state_mismatch');
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, stateRecord.codeVerifier);
  } catch (e) {
    logger.error('wallet.auth_callback.token_exchange_failed', { error: e });
    return failRedirect(request, 'token_exchange_failed');
  }

  if (tokens.idToken) {
    try {
      await verifyIdToken(tokens.idToken, stateRecord.nonce);
    } catch (e) {
      logger.error('wallet.auth_callback.id_token_verification_failed', { error: e });
      return failRedirect(request, 'id_token_verification_failed');
    }
  }

  const dest = new URL(stateRecord.redirectTo, request.nextUrl.origin);
  const response = NextResponse.redirect(dest);
  writeSessionCookies(response.cookies, tokens);
  return response;
}

function failRedirect(request: NextRequest, code: string): NextResponse {
  const url = new URL('/login', request.nextUrl.origin);
  url.searchParams.set('error', code);
  // 에러 fallback 도 prompt 없이 (사용자가 hub 를 보고 재시도하도록).
  url.searchParams.set('prompt', '');
  return NextResponse.redirect(url);
}
