import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireBackendBaseUrl } from "@/lib/config/backend"

/**
 * 새 accessToken으로 Medusa JWT를 발급받습니다.
 */
async function fetchMedusaToken(accessToken: string): Promise<string | null> {
  try {
    const medusaBaseUrl = requireBackendBaseUrl("medusa")
    const res = await fetch(`${medusaBaseUrl}/auth/customer/my-auth`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!res.ok) {
      console.error("Medusa signin failed:", res.status)
      return null
    }

    const data = await res.json()
    return data.token ?? null
  } catch (error) {
    console.error("Medusa signin error:", error)
    return null
  }
}

const isIpHost = (hostname: string) => {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":")
}

const getSecondLevelDomain = (hostname: string): string | undefined => {
  if (!hostname || hostname === "localhost" || isIpHost(hostname)) {
    return undefined
  }

  const parts = hostname.split(".").filter(Boolean)

  if (parts.length < 2) {
    return undefined
  }

  return parts.slice(-2).join(".")
}

const clearAuthCookies = (response: NextResponse, domain?: string) => {
  response.cookies.set("accessToken", "", {
    maxAge: -1,
    path: "/",
  })
  if (domain) {
    response.cookies.set("accessToken", "", {
      maxAge: -1,
      path: "/",
      domain,
    })
  }

  response.cookies.set("refreshToken", "", {
    maxAge: -1,
    path: "/",
  })
  if (domain) {
    response.cookies.set("refreshToken", "", {
      maxAge: -1,
      path: "/",
      domain,
    })
  }

  response.cookies.delete("_medusa_jwt")
}

export async function POST(request: NextRequest) {
  try {
    const tokenCookieDomain = getSecondLevelDomain(request.nextUrl.hostname)
    const cookieStore = await cookies()
    const returnUrl = request.nextUrl.searchParams.get("returnUrl")

    const refreshToken = cookieStore.get("refreshToken")?.value

    if (!refreshToken) {
      const response = NextResponse.json(
        {
          success: false,
          message: "No refresh token",
        },
        { status: 401 }
      )

      clearAuthCookies(response, tokenCookieDomain)

      return response
    }

    const usersBaseUrl = requireBackendBaseUrl("users")

    const res = await fetch(`${usersBaseUrl}/auth/restore-token`, {
      method: "POST",
      headers: {
        Cookie: `refreshToken=${refreshToken}`,
      },
      credentials: "include",
    })

    if (!res.ok) {
      throw new Error("Restore token failed!!")
    }

    const data = await res.json()
    const newAccessToken = data.data.accessToken

    // 토큰 복구 성공 - JSON 응답으로 처리
    const response = NextResponse.json(
      {
        success: true,
        message: "Token restored successfully",
      },
      { status: 200 }
    )

    if (tokenCookieDomain) {
      response.cookies.set("accessToken", "", {
        maxAge: -1,
        path: "/",
      })
    }

    response.cookies.set("accessToken", newAccessToken, {
      path: "/",
      ...(tokenCookieDomain ? { domain: tokenCookieDomain } : {}),
    })

    // 새 accessToken으로 Medusa JWT도 갱신
    const medusaToken = await fetchMedusaToken(newAccessToken)
    if (medusaToken) {
      response.cookies.set("_medusa_jwt", medusaToken, {
        maxAge: 60 * 60 * 24 * 30, // 30일
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      })
    }

    return response
  } catch (error) {
    console.error("Restore token error:", error)

    const referer = request.headers.get("referer")
    let isMainPage = false

    // 메인페이지에서 요청된 경우 체크
    if (referer) {
      try {
        const refererUrl = new URL(referer)
        const pathname = refererUrl.pathname

        isMainPage = /^\/[a-z]{2}\/?$/.test(pathname)
      } catch (urlError) {
        // URL 파싱 에러는 무시
      }
    }

    // 모든 페이지에서 JSON 응답으로 처리
    const response = NextResponse.json(
      {
        success: false,
        isMainPage: isMainPage,
        message: isMainPage
          ? "Token expired on main page"
          : "Token expired, login required",
      },
      { status: 401 }
    )

    const tokenCookieDomain = getSecondLevelDomain(request.nextUrl.hostname)
    clearAuthCookies(response, tokenCookieDomain)

    return response
  }
}
