import "server-only"

import { authEnv } from "../auth/env"
import { getParentAccessToken } from "../auth/parent-cookies"

// Validate the existing session with its issuer. Decoding JWTs is not authentication.
async function fetchWithSession(url: string, accessToken: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    return await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

/** The signed-in member's id, null when signed out. Throws when the login service is down. */
export async function getSignedInMemberId(): Promise<string | null> {
  const accessToken = await getParentAccessToken()
  if (!accessToken) return null
  const response = await fetchWithSession(`${authEnv.userServiceUrl}/users/me`, accessToken)
  if (response.status === 401 || response.status === 403) return null
  if (!response.ok) throw new Error("Login service unavailable")
  const body = await response.json()
  return body?.success === true && typeof body?.data?.id === "string" && body.data.id.length > 0 ? body.data.id : null
}
