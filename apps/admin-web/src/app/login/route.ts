import { NextResponse, type NextRequest } from "next/server";

import { createAuthorizationRequest } from "@/lib/auth/oidc-client";
import { writeStateCookie } from "@/lib/auth/session-cookies";

/**
 * /login 진입점.
 * - 로컬 redirect_to 만 허용 (절대 URL/외부 origin 거부) → IdP 가 callback 으로 돌려보낼 때
 *   admin-web 내부 경로로만 복귀하도록 강제.
 * - state/nonce/PKCE verifier 를 단기 HttpOnly 쿠키 (`oidc_state`) 로 보존.
 * - IdP authorize URL 로 302.
 *
 * Route Handler 인 이유: Server Component 렌더 단계에서는 cookie mutation 이 막혀 있어
 * `NextResponse#cookies` 에 직접 써야 한다.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const redirectTo = sanitizeInternalRedirect(req.nextUrl.searchParams.get("redirect_to"));

  const { authorizeUrl, stateRecord } = createAuthorizationRequest(redirectTo);
  const res = NextResponse.redirect(authorizeUrl);
  writeStateCookie(res.cookies, stateRecord);
  return res;
}

function sanitizeInternalRedirect(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}
