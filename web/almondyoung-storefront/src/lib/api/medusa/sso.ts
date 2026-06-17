"use server"

import { requireBackendBaseUrl } from "@/lib/config/backend"
import {
  getCacheTag,
  getCartId,
  removeAllAuthTokens,
  setMedusaAuthToken,
  setTokenCookies,
} from "@lib/data/cookies"
import { syncInterestPrefsFromServer } from "@lib/data/interest-categories"
import { toLocalizedPath } from "@/lib/utils/locale-path"
import { revalidateTag } from "next/cache"
import { redirect } from "next/navigation"
import { recoverCustomerCart, transferCart } from "./customer"

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ""

const decodeJwtPayload = <T = Record<string, unknown>>(token: string): T => {
  const parts = token.split(".")
  if (parts.length < 2) throw new Error("invalid JWT format")
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as T
}

const buildCallbackUrl = (countryCode: string): string => {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:8000"
  return `${base}/${countryCode}/callback/oidc`
}

const medusaFetch = async (
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {}
): Promise<Response> => {
  const baseUrl = requireBackendBaseUrl("medusa")
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(init.headers ?? {}),
  }
  if (PUBLISHABLE_KEY) headers["x-publishable-api-key"] = PUBLISHABLE_KEY
  if (init.body && !headers["content-type"]) {
    headers["content-type"] = "application/json"
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers, cache: "no-store" })
}

/**
 * 사용자가 로그인 버튼을 누르면 호출됨. medusa /auth/customer/user-service-sso 가
 * authorize URL을 location으로 반환하며, 여기서 Next.js redirect로 사용자를 그곳으로 보낸다.
 */
export async function startOidcLogin(
  countryCode: string,
  redirectTo?: string,
  prompt?: "login" | "select_account"
): Promise<void> {
  const callbackUrl = buildCallbackUrl(countryCode)

  const res = await medusaFetch("/auth/customer/user-service-sso", {
    method: "POST",
    body: JSON.stringify({
      callback_url: callbackUrl,
      ...(redirectTo ? { redirect_to: redirectTo } : {}),
      ...(prompt ? { prompt } : {}),
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`startOidcLogin failed: ${res.status} ${text}`)
  }

  const json = (await res.json()) as { location?: string }
  if (!json.location) {
    throw new Error("startOidcLogin: provider did not return location")
  }

  redirect(json.location)
}

type DecodedToken = {
  actor_id?: string
  auth_identity_id?: string
  actor_type?: string
  app_metadata?: { customer_id?: string }
  // Medusa core 가 generateJwtTokenForAuthIdentity 에서 provider_identity.user_metadata 를 그대로 embed.
  // 우리 user-service-sso 가 채우는 키: email, name, login_id, email_verified.
  user_metadata?: {
    email?: string
    name?: string
    login_id?: string
    email_verified?: boolean
    user_id?: string
  }
}

/**
 * IdP에서 redirect로 ?code & state 와 함께 돌아왔을 때 호출됨.
 * 1) medusa /auth/customer/user-service-sso/callback 으로 검증 → JWT 수령
 * 2) JWT에 actor_id가 없으면(=신규) /store/customers로 customer 생성 → /auth/token/refresh
 * 3) _medusa_jwt 쿠키 세팅 + 카트 인계 + redirect
 */
export async function oidcCallback(args: {
  code: string
  state: string
  countryCode: string
  redirectTo?: string
}): Promise<{ success: true; redirectTo: string } | { success: false; error: string }> {
  const { code, state, countryCode } = args

  const callbackRes = await medusaFetch(
    `/auth/customer/user-service-sso/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    { method: "GET" }
  )

  if (!callbackRes.ok) {
    const text = await callbackRes.text().catch(() => "")
    return { success: false, error: `callback failed: ${callbackRes.status} ${text}` }
  }

  const callbackJson = (await callbackRes.json()) as {
    token: string
    idp_tokens?: { access_token: string; refresh_token: string; expires_at?: number }
    redirect_to?: string
  }
  const { token, idp_tokens, redirect_to: oidcRedirectTo } = callbackJson
  if (!token) {
    return { success: false, error: "no token in callback response" }
  }
  if (!idp_tokens?.access_token || !idp_tokens?.refresh_token) {
    return { success: false, error: "callback did not include idp_tokens — provider misconfigured" }
  }

  let finalToken = token
  let decoded: DecodedToken
  try {
    decoded = decodeJwtPayload<DecodedToken>(token)
  } catch (e) {
    return { success: false, error: `failed to decode JWT: ${(e as Error).message}` }
  }

  // 신규 사용자: customer 레코드가 없으므로 생성 후 토큰 재발급.
  // Medusa POST /store/customers 는 body.email 을 필수로 요구 (validate-customer-account-creation step).
  // user-service SSO provider 가 user_metadata 에 email/name 을 채워 두므로, JWT 에서 꺼내 그대로 전달한다.
  if (!decoded.actor_id && !decoded.app_metadata?.customer_id) {
    const email = decoded.user_metadata?.email
    if (!email) {
      return {
        success: false,
        error: "user_metadata.email missing in auth token — check user-service-sso provider mapping",
      }
    }
    const fullName = decoded.user_metadata?.name?.trim()
    const [firstName, ...rest] = fullName ? fullName.split(/\s+/) : []
    const lastName = rest.join(" ") || undefined
    const createRes = await medusaFetch(`/store/customers`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        email,
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName ? { last_name: lastName } : {}),
        metadata: {
          almond_user_id: decoded.user_metadata?.user_id,
          almond_login_id: decoded.user_metadata?.login_id,
        },
      }),
    })

    if (!createRes.ok) {
      const text = await createRes.text().catch(() => "")
      return { success: false, error: `customer create failed: ${createRes.status} ${text}` }
    }

    const refreshRes = await medusaFetch(`/auth/token/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    })
    if (!refreshRes.ok) {
      const text = await refreshRes.text().catch(() => "")
      return { success: false, error: `token refresh failed: ${refreshRes.status} ${text}` }
    }
    const refreshed = (await refreshRes.json()) as { token: string }
    finalToken = refreshed.token
  }

  await setMedusaAuthToken(finalToken)
  const accessTokenMaxAge = idp_tokens.expires_at
    ? Math.max(1, Math.floor((idp_tokens.expires_at - Date.now()) / 1000))
    : undefined
  await setTokenCookies(
    idp_tokens.access_token,
    idp_tokens.refresh_token,
    accessTokenMaxAge
  )

  // 로그인 직후 user-service prefs 를 anon 쿠키와 동기화
  // (서버에 prefs 가 비어있으면 anon 선택값/dismiss 도 폐기되어 다시 묻기 시작)
  await syncInterestPrefsFromServer()

  const customerCacheTag = await getCacheTag("customers")
  if (customerCacheTag) revalidateTag(customerCacheTag)

  // 게스트 카트 인계 / 기존 카트 복구
  const cartId = await getCartId()
  try {
    if (cartId) {
      await transferCart()
    } else {
      await recoverCustomerCart()
    }
  } catch (e) {
    console.warn("[oidcCallback] cart sync failed", (e as Error).message)
  }

  // Medusa state의 redirect_to 우선, 없으면 URL 파라미터, 없으면 홈. 외부 URL은 toLocalizedPath가 차단.
  const redirectTo = toLocalizedPath(countryCode, oidcRedirectTo ?? args.redirectTo)

  return { success: true, redirectTo }
}

/**
 * 로그아웃: _medusa_jwt 제거 후 auth-web /oauth/end_session 으로 redirect.
 *
 * end_session 은 user-service(백엔드)가 아니라 auth-web(IdP 프론트)으로 보낸다. authorize 가
 * auth-web 에 있으므로 로그아웃도 같은 곳을 거쳐야 한다. user-service 로 직접 navigate 하면
 * (1) auth-web host-only 세션 쿠키를 cross-domain 이라 못 지우고, (2) Bearer 가 없어 DB 토큰
 * revoke 도 스킵돼, 다음 로그인 시 계정 리스트에서 비밀번호 없이 자동 재로그인되는 버그가 난다.
 * auth-web end_session 라우트가 host-only 쿠키 정리 + S2S revoke + 계정 허브 RT 무효화를 모두 수행한다.
 */
export async function oidcSignOut(countryCode: string): Promise<void> {
  console.log("[logout] oidcSignOut 진입")
  // _medusa_jwt 와 user-service accessToken/refreshToken 모두 제거 (단일 OIDC 세션 라이프사이클).
  await removeAllAuthTokens()
  console.log("[logout] oidcSignOut: removeAllAuthTokens 완료")

  const authWebOrigin =
    process.env.AUTH_WEB_ORIGIN ?? process.env.NEXT_PUBLIC_AUTH_WEB_ORIGIN
  const clientId = process.env.OIDC_CLIENT_ID ?? "medusa-storefront"
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:8000"
  console.log(
    "[logout] oidcSignOut: authWebOrigin=",
    authWebOrigin,
    "clientId=",
    clientId,
    "base=",
    base
  )

  if (!authWebOrigin) {
    console.log("[logout] oidcSignOut: authWebOrigin 없음 → 홈으로 redirect")
    redirect(`/${countryCode}`)
  }

  const url = new URL("/oauth/end_session", authWebOrigin)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("post_logout_redirect_uri", `${base}/${countryCode}`)

  console.log("[logout] oidcSignOut: end_session redirect 직전 url=", url.toString())
  redirect(url.toString())
}
