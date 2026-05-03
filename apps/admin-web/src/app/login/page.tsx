import { redirect } from "next/navigation";

import { createAuthorizationRequest } from "@/lib/auth/oidc-client";
import { setStateCookie } from "@/lib/auth/session-cookies";

/**
 * /login 진입점.
 * - 로컬 redirect_to 만 허용 (절대 URL/외부 origin 거부) → IdP 가 callback 으로 돌려보낼 때
 *   admin-web 내부 경로로만 복귀하도록 강제.
 * - state/nonce/PKCE verifier 를 단기 HttpOnly 쿠키 (`oidc_state`) 로 보존.
 * - IdP authorize URL 로 302.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = sanitizeInternalRedirect(params.redirect_to);

  const { authorizeUrl, stateRecord } = createAuthorizationRequest(redirectTo);
  await setStateCookie(stateRecord);

  redirect(authorizeUrl);
}

function sanitizeInternalRedirect(value: string | undefined): string {
  if (!value) return "/";
  // 외부 URL, protocol-relative URL 거부. 명시적으로 / 로 시작하는 경로만 허용.
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}
