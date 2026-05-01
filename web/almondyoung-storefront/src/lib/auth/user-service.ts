// SOURCE OF TRUTH: almondyoung-server/web/auth-web/lib/user-service.ts (subset)
// Keep in sync. Only restoreAccessToken / getMe are needed by storefront.
import "server-only"

import { authEnv } from "./env"

type ApiEnvelope<T> = { success: boolean; data: T }

export type UserProfile = {
  id: string
  loginId: string
  username: string
  email: string
  isEmailVerified: boolean
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(
      `user-service returned non-JSON (${res.status}): ${text.slice(0, 200)}`
    )
  }
}

async function readApiData<T>(res: Response): Promise<T> {
  const body = await readJson<ApiEnvelope<T>>(res)
  return body.data
}

async function throwIfBad(res: Response, ctx: string): Promise<void> {
  if (res.ok) return
  const text = await res.text()
  let message = text
  try {
    const body = JSON.parse(text)
    message = body?.message ?? text
    if (Array.isArray(message)) message = message.join(", ")
  } catch {
    // keep raw
  }
  throw new Error(`[${ctx}] ${res.status}: ${message}`)
}

export async function restoreAccessToken(
  refreshToken: string
): Promise<string> {
  const res = await fetch(`${authEnv.userServiceUrl}/auth/restore-token`, {
    method: "POST",
    headers: { cookie: `refreshToken=${refreshToken}` },
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "restore-token")
  const body = await readApiData<{ accessToken?: string }>(res)
  if (body.accessToken) return body.accessToken
  const setCookie = res.headers.get("set-cookie") ?? ""
  const m = setCookie.match(/accessToken=([^;]+)/)
  if (m?.[1]) return m[1]
  throw new Error("[restore-token] accessToken missing in response")
}

export async function getMe(accessToken: string): Promise<UserProfile> {
  const res = await fetch(`${authEnv.userServiceUrl}/users/me`, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "me")
  return readApiData<UserProfile>(res)
}
