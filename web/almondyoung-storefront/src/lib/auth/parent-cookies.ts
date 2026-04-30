// SOURCE OF TRUTH: almondyoung-server/web/auth-web/lib/parent-cookies.ts
// Keep in sync. Update auth-web first, then mirror here.
import "server-only"

import { cookies } from "next/headers"

import { authEnv } from "./env"

const ACCESS_TOKEN = "accessToken"
const REFRESH_TOKEN = "refreshToken"

const ACCESS_MAX_AGE = 60 * 15 // 15 min (user-service 기본값과 동일)
const REFRESH_MAX_AGE = 60 * 60 * 24 * 14 // 2 weeks (rememberMe=false 기준)

export async function setParentAuthCookies(tokens: {
  accessToken: string
  refreshToken: string
  rememberMe?: boolean
}): Promise<void> {
  const jar = await cookies()
  const common = {
    domain: authEnv.parentCookieDomain,
    httpOnly: true,
    secure: authEnv.parentCookieSecure,
    sameSite: authEnv.parentCookieSameSite,
    path: "/",
  }
  jar.set(ACCESS_TOKEN, tokens.accessToken, {
    ...common,
    maxAge: ACCESS_MAX_AGE,
  })
  jar.set(REFRESH_TOKEN, tokens.refreshToken, {
    ...common,
    maxAge: tokens.rememberMe ? 60 * 60 * 24 * 90 : REFRESH_MAX_AGE,
  })
}

export async function hasParentRefreshToken(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(REFRESH_TOKEN)?.value ?? null
}

export async function getParentAccessToken(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(ACCESS_TOKEN)?.value ?? null
}

export const PARENT_COOKIE_NAMES = {
  ACCESS_TOKEN,
  REFRESH_TOKEN,
} as const
