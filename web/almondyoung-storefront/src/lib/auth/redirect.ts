import "server-only"

import { authEnv } from "./env"

/** auth-web /signin URL 빌드 (redirect_to 포함) */
export function buildAuthWebSigninUrl(returnTo: string): string {
  const url = new URL("/signin", authEnv.authWebOrigin)
  if (returnTo) url.searchParams.set("redirect_to", returnTo)
  return url.toString()
}
