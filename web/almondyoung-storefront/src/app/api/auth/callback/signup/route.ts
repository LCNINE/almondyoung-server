import { siteConfig } from "@/lib/config/site"
import { setTokenCookies, setMedusaAuthToken } from "@lib/data/cookies"
import { NextRequest, NextResponse } from "next/server"
import { requireBackendBaseUrl } from "@/lib/config/backend"

const MEDUSA_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ""

async function fetchMedusaSignin(accessToken: string) {
  const medusaBaseUrl = requireBackendBaseUrl("medusa")
  const response = await fetch(`${medusaBaseUrl}/auth/customer/my-auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY,
    },
  })
  if (!response.ok) return null
  const data = await response.json()
  return data.token ?? data.data?.token ?? null
}

async function fetchMedusaSignup(
  accessToken: string,
  params: {
    email: string
    first_name: string
    last_name: string
    almond_user_id: string
    almond_login_id: string
  }
) {
  const medusaBaseUrl = requireBackendBaseUrl("medusa")
  const response = await fetch(
    `${medusaBaseUrl}/auth/customer/my-auth/register`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(params),
    }
  )
  return response.ok
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const userId = searchParams.get("userId")
    const redirectTo =
      searchParams.get("redirect_to") ?? siteConfig.auth.redirect_to

    if (!userId) {
      return NextResponse.redirect(new URL("/login", request.url))
    }

    // 1. user-service에서 토큰 받아오기
    const usersBaseUrl = requireBackendBaseUrl("users")

    const response = await fetch(`${usersBaseUrl}/auth/callback/signup`, {
      method: "POST",
      body: JSON.stringify({ userId }),
      headers: { "Content-Type": "application/json" },
    })

    const result = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          message: result.message || "Callback signup failed",
        },
        { status: response.status }
      )
    }

    const { accessToken, refreshToken } = result.data

    // 2. 쿠키에 토큰 설정
    await setTokenCookies(accessToken, refreshToken)

    // 3. 이미 메두사 회원인지 체크 (로그인 시도)
    const medusaToken = await fetchMedusaSignin(accessToken)

    if (medusaToken) {
      await setMedusaAuthToken(medusaToken)
      return NextResponse.redirect(new URL(redirectTo, request.url))
    }

    // 4. 신규 메두사 회원 가입 처리
    const currentUser = await fetch(`${usersBaseUrl}/users/${userId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!currentUser.ok) {
      return NextResponse.json(
        { success: false, error: "Current user not found" },
        { status: currentUser.status }
      )
    }

    const currentUserData = await currentUser.json()

    if (currentUserData.success) {
      const signupOk = await fetchMedusaSignup(accessToken, {
        email: currentUserData.data.email,
        first_name: currentUserData.data.username,
        last_name: currentUserData.data.username,
        almond_user_id: currentUserData.data.id,
        almond_login_id: currentUserData.data.loginId,
      })

      if (!signupOk) {
        console.error("medusaSignup failed")
        return NextResponse.redirect(
          new URL("/login?error=signup_failed", request.url)
        )
      }
    }

    // 5. 메두사 로그인 처리
    const finalToken = await fetchMedusaSignin(accessToken)
    if (finalToken) {
      await setMedusaAuthToken(finalToken)
    }

    return NextResponse.redirect(new URL(redirectTo, request.url))
  } catch (error) {
    console.error("Signup callback error:", error)
    return NextResponse.redirect(
      new URL("/login?error=callback_failed", request.url)
    )
  }
}
