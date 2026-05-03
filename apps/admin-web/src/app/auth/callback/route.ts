import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  consumeStateCookie,
  setSessionCookies,
} from "@/lib/auth/session-cookies";
import {
  exchangeCodeForTokens,
  verifyIdToken,
  type OidcStateRecord,
} from "@/lib/auth/oidc-client";

/**
 * IdP 가 사용자 동의/로그인 완료 후 redirect 로 진입하는 callback 라우트.
 *
 * 1. `oidc_state` 쿠키에서 state/nonce/codeVerifier/redirectTo 복원 (1회용 — consume 시 삭제)
 * 2. 쿼리스트링 state 와 쿠키 state 대조 (CSRF)
 * 3. /oauth/token 에 code + verifier 로 토큰 교환
 * 4. id_token 의 nonce 가 쿠키에 저장된 nonce 와 일치하는지 + 서명/iss/aud 검증
 * 5. accessToken/refreshToken/idToken 을 자체 도메인 HttpOnly 쿠키로 발급
 * 6. redirectTo 로 302
 *
 * 어느 단계에서 실패하든 /login?error=... 로 떨어뜨려 사용자가 재시도할 수 있게 한다.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const stateFromQuery = url.searchParams.get("state");
  const errorFromIdp = url.searchParams.get("error");

  if (errorFromIdp) {
    return failRedirect(request, errorFromIdp);
  }
  if (!code || !stateFromQuery) {
    return failRedirect(request, "missing_code_or_state");
  }

  const stateRecord = await consumeStateCookie<OidcStateRecord>();
  if (!stateRecord) {
    return failRedirect(request, "state_cookie_missing");
  }
  if (stateRecord.state !== stateFromQuery) {
    return failRedirect(request, "state_mismatch");
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, stateRecord.codeVerifier);
  } catch (e) {
    console.error("[oidc-callback] token exchange failed", e);
    return failRedirect(request, "token_exchange_failed");
  }

  if (tokens.idToken) {
    try {
      await verifyIdToken(tokens.idToken, stateRecord.nonce);
    } catch (e) {
      console.error("[oidc-callback] id_token verification failed", e);
      return failRedirect(request, "id_token_verification_failed");
    }
  }

  const dest = new URL(stateRecord.redirectTo, request.nextUrl.origin);
  const response = NextResponse.redirect(dest);

  // NextResponse.redirect 의 cookies API 는 .set 을 지원 — session-cookies 의 writeSessionCookies 가
  // jar 를 받아 동일한 옵션으로 access/refresh/id token 을 모두 박는다.
  const { writeSessionCookies } = await import("@/lib/auth/session-cookies");
  writeSessionCookies(response.cookies, tokens);

  return response;
}

function failRedirect(request: NextRequest, code: string): NextResponse {
  const url = new URL("/login", request.nextUrl.origin);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}
