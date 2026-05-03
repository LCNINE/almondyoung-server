import "server-only";

import { cookies } from "next/headers";

import { env } from "./env";

/**
 * IdP (auth-web) 자체 세션 쿠키.
 *
 * 과거에는 parent 도메인 (`.example.com`) 에 심어 admin-web 등 RP 가 직접 읽었지만,
 * 이제 RP 들은 OIDC code flow 로 자기 토큰을 받으므로 parent 공유는 불필요·금지.
 * 여기서는 **auth-web host 에만 바인딩되는** host-only 쿠키만 발급한다.
 *
 * 이 쿠키의 유일한 소비자는 auth-web 자신 (`/oauth/authorize` 의 silent SSO 판단,
 * `/` 의 활성 계정 표시) 이며, 다른 호스트로 누설되지 않는다.
 */

const ACCESS_TOKEN = "accessToken";
const REFRESH_TOKEN = "refreshToken";

const ACCESS_MAX_AGE = 60 * 15; // 15 min (user-service 기본값과 동일)
const REFRESH_MAX_AGE = 60 * 60 * 24 * 14; // 2 weeks (rememberMe=false 기준)

function commonOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    // domain 미지정: host-only 쿠키 → auth-web 호스트에만 바인딩.
  };
}

export async function setIdpSessionCookies(tokens: {
  accessToken: string;
  refreshToken: string;
  rememberMe?: boolean;
}): Promise<void> {
  const jar = await cookies();
  const common = commonOptions();
  jar.set(ACCESS_TOKEN, tokens.accessToken, {
    ...common,
    maxAge: ACCESS_MAX_AGE,
  });
  jar.set(REFRESH_TOKEN, tokens.refreshToken, {
    ...common,
    maxAge: tokens.rememberMe ? 60 * 60 * 24 * 90 : REFRESH_MAX_AGE,
  });
}

export async function hasIdpRefreshToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(REFRESH_TOKEN)?.value ?? null;
}

export async function getIdpAccessToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACCESS_TOKEN)?.value ?? null;
}

/** IdP 세션 쿠키 즉시 만료. setIdpSessionCookies 와 동일 옵션으로 set + maxAge=0. */
export async function clearIdpSessionCookies(): Promise<void> {
  const jar = await cookies();
  const common = { ...commonOptions(), maxAge: 0 };
  jar.set(ACCESS_TOKEN, "", common);
  jar.set(REFRESH_TOKEN, "", common);
}
