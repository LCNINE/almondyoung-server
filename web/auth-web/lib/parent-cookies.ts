import "server-only";

import { cookies } from "next/headers";

import { env } from "./env";

const ACCESS_TOKEN = "accessToken";
const REFRESH_TOKEN = "refreshToken";

const ACCESS_MAX_AGE = 60 * 15; // 15 min (user-service 기본값과 동일)
const REFRESH_MAX_AGE = 60 * 60 * 24 * 14; // 2 weeks (rememberMe=false 기준)

/**
 * parent 도메인에 accessToken/refreshToken 쿠키를 심는다.
 * user-service가 내려 주는 쿠키 속성과 동일해야 중복이 생기지 않는다.
 */
export async function setParentAuthCookies(tokens: {
  accessToken: string;
  refreshToken: string;
  rememberMe?: boolean;
}): Promise<void> {
  const jar = await cookies();
  const common = {
    domain: env.parentCookieDomain,
    httpOnly: true,
    secure: env.parentCookieSecure,
    sameSite: env.parentCookieSameSite,
    path: "/",
  };
  jar.set(ACCESS_TOKEN, tokens.accessToken, {
    ...common,
    maxAge: ACCESS_MAX_AGE,
  });
  jar.set(REFRESH_TOKEN, tokens.refreshToken, {
    ...common,
    maxAge: tokens.rememberMe ? 60 * 60 * 24 * 90 : REFRESH_MAX_AGE,
  });
}

export async function hasParentRefreshToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(REFRESH_TOKEN)?.value ?? null;
}
