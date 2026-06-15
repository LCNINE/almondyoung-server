import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireBackendBaseUrl } from "@/lib/config/backend"
import { restoreAccessToken } from "@/lib/auth/user-service"

export const dynamic = "force-dynamic"
export const revalidate = 0

const isIpHost = (hostname: string) => {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":")
}

const getSecondLevelDomain = (hostname: string): string | undefined => {
  if (!hostname || hostname === "localhost" || isIpHost(hostname)) {
    return undefined
  }

  const parts = hostname.split(".").filter(Boolean)
  if (parts.length < 2) return undefined
  return parts.slice(-2).join(".")
}

const clearAuthCookies = (response: NextResponse, domain?: string) => {
  response.cookies.set("accessToken", "", { maxAge: -1, path: "/" })
  if (domain) {
    response.cookies.set("accessToken", "", { maxAge: -1, path: "/", domain })
  }

  response.cookies.set("refreshToken", "", { maxAge: -1, path: "/" })
  if (domain) {
    response.cookies.set("refreshToken", "", { maxAge: -1, path: "/", domain })
  }

  response.cookies.delete("_medusa_jwt")
}

const normalizeReturnTo = (value: string | null): string => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/"
  }

  return value
}

type OidcTokenResponse = {
  access_token: string
  refresh_token: string
  token_type: "Bearer"
  expires_in: number
}

/**
 * 표준 OIDC refresh_token grant 로 user-service 의 access/refresh 를 회전한다.
 * RFC 6749 §6. 기존의 user-service 자체 /auth/restore-token (비표준) 호출을 대체.
 */
async function refreshOidcTokens(refreshToken: string): Promise<OidcTokenResponse> {
  const issuer =
    process.env.OIDC_ISSUER_URL ?? process.env.NEXT_PUBLIC_USER_SERVICE_URL
  const clientId = process.env.OIDC_CLIENT_ID ?? "medusa-storefront"
  const clientSecret = process.env.OIDC_CLIENT_SECRET

  if (!issuer) throw new Error("OIDC_ISSUER_URL not configured")
  if (!clientSecret) throw new Error("OIDC_CLIENT_SECRET not configured")

  const tokenUrl = new URL("/oauth/token", issuer).toString()
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  })

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`oauth/token responded ${res.status}: ${text}`)
  }

  return (await res.json()) as OidcTokenResponse
}

/**
 * Medusa 표준 /auth/token/refresh — 기존 _medusa_jwt 를 Bearer 로 받아 새 JWT 발급.
 * user-service refresh 와 같은 호출 안에서 함께 회전시켜 두 토큰 라이프사이클을 묶는다.
 */
async function refreshMedusaJwt(currentMedusaJwt: string): Promise<string | null> {
  try {
    const baseUrl = requireBackendBaseUrl("medusa")
    const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ""
    const res = await fetch(`${baseUrl}/auth/token/refresh`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${currentMedusaJwt}`,
        ...(publishableKey ? { "x-publishable-api-key": publishableKey } : {}),
      },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { token?: string }
    return data.token ?? null
  } catch {
    return null
  }
}

async function restoreTokens(
  request: NextRequest,
  response: NextResponse,
  failureResponse: NextResponse
): Promise<NextResponse> {
  const tokenCookieDomain = getSecondLevelDomain(request.nextUrl.hostname)
  let refreshToken: string | undefined

  try {
    const cookieStore = await cookies()
    refreshToken = cookieStore.get("refreshToken")?.value
    const currentMedusaJwt = cookieStore.get("_medusa_jwt")?.value

    if (!refreshToken) {
      clearAuthCookies(failureResponse, tokenCookieDomain)
      return failureResponse
    }

    const tokens = await refreshOidcTokens(refreshToken)

    // 도메인 충돌 방지: domain 지정 쿠키로 갱신할 때는 path-only 잔존 쿠키를 먼저 만료시킨다.
    if (tokenCookieDomain) {
      response.cookies.set("accessToken", "", { maxAge: -1, path: "/" })
      response.cookies.set("refreshToken", "", { maxAge: -1, path: "/" })
    }

    response.cookies.set("accessToken", tokens.access_token, {
      path: "/",
      maxAge: tokens.expires_in,
      ...(tokenCookieDomain ? { domain: tokenCookieDomain } : {}),
    })
    response.cookies.set("refreshToken", tokens.refresh_token, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      ...(tokenCookieDomain ? { domain: tokenCookieDomain } : {}),
    })

    if (currentMedusaJwt) {
      const newMedusaJwt = await refreshMedusaJwt(currentMedusaJwt)
      if (newMedusaJwt) {
        response.cookies.set("_medusa_jwt", newMedusaJwt, {
          maxAge: 60 * 60 * 24 * 30,
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          path: "/",
        })
      }
      // Medusa JWT refresh 가 실패해도 user-service 토큰은 회전되어 있으므로 200 으로 응답.
      // 다음 Medusa 호출에서 401 이 나면 그때 재로그인을 유도한다.
    }

    return response
  } catch (error) {
    // oauth_tokens 에 없는 레거시 JWT refreshToken → deprecated /auth/restore-token 으로 accessToken 재발급.
    // 성공 시 accessToken 교체(refreshToken 은 JWT 그대로), 실패 시 쿠키 클리어 후 재로그인.
    const isStaleToken =
      error instanceof Error && error.message.includes("invalid refresh_token")

    if (isStaleToken && refreshToken) {
      const legacyAccessToken = await restoreAccessToken(refreshToken).catch(
        () => null
      )
      if (legacyAccessToken) {
        if (tokenCookieDomain) {
          response.cookies.set("accessToken", "", { maxAge: -1, path: "/" })
        }
        response.cookies.set("accessToken", legacyAccessToken, {
          path: "/",
          maxAge: 60 * 15,
          ...(tokenCookieDomain ? { domain: tokenCookieDomain } : {}),
        })
        return response
      }
      console.warn("Restore token: stale refresh token, clearing session")
    } else {
      console.error("Restore token error:", error)
    }

    const referer = request.headers.get("referer")
    let isMainPage = false
    if (referer) {
      try {
        const refererUrl = new URL(referer)
        isMainPage = /^\/[a-z]{2}\/?$/.test(refererUrl.pathname)
      } catch {
        // ignore
      }
    }

    const isJsonFailure =
      failureResponse.headers.get("content-type")?.includes("application/json")

    if (isJsonFailure) {
      const response = NextResponse.json(
        {
          success: false,
          isMainPage,
          message: isMainPage
            ? "Token expired on main page"
            : "Token expired, login required",
        },
        { status: 401 }
      )
      clearAuthCookies(response, tokenCookieDomain)
      return response
    }

    clearAuthCookies(failureResponse, tokenCookieDomain)
    return failureResponse
  }
}

export async function POST(request: NextRequest) {
  return restoreTokens(
    request,
    NextResponse.json(
      { success: true, message: "Token restored successfully" },
      { status: 200 }
    ),
    NextResponse.json(
      { success: false, message: "No refresh token" },
      { status: 401 }
    )
  )
}

export async function GET(request: NextRequest) {
  const returnTo = normalizeReturnTo(request.nextUrl.searchParams.get("return_to"))
  return restoreTokens(
    request,
    NextResponse.redirect(new URL(returnTo, request.url)),
    NextResponse.redirect(new URL("/", request.url))
  )
}
