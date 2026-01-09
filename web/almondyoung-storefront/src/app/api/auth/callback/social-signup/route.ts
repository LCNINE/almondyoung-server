import { medusaSignin } from "@lib/api/medusa/signin"
import { medusaSignup } from "@lib/api/medusa/signup"
import { appConfig } from "@/lib/config/medusa"
import { getAccessToken, setTokenCookies } from "@lib/data/cookies"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const userId = searchParams.get("userId")
    const social = searchParams.get("social")
    const countryCode = searchParams.get("countryCode") ?? "kr"
    const redirectTo =
      searchParams.get("redirect_to") ?? appConfig.auth.redirect_to

    // 아몬드영 토큰 생성 및 회원 생성
    const response = await fetch(
      `${process.env.BACKEND_URL}/users/auth/social/set-cookie`,
      {
        method: "POST",
        body: JSON.stringify({ userId, social }),
        headers: {
          "Content-Type": "application/json",
        },
      }
    )
    if (!response.ok) {
      const result = await response.json()
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          message: result.message || "Social set cookie failed",
        },
        { status: response.status }
      )
    }

    const result = await response.json()

    const { accessToken, refreshToken } = result.data
    setTokenCookies(accessToken, refreshToken)

    const token = await getAccessToken()

    // 이미 메두사 회원인지 체크
    const medusaSigninResponse = await medusaSignin()

    if (medusaSigninResponse.success) {
      // 소셜 유저 동의 페이지로 리다이렉트
      const consentsRes = await getSocialUserConsentRedirectUrl(token!)
      if (!consentsRes) {
        return NextResponse.redirect(
          new URL(
            `/${countryCode}/consents?redirect_to=${redirectTo}`,
            request.url
          )
        )
      }

      return NextResponse.redirect(new URL(redirectTo, request.url))
    }

    // 이미 메두사 회원이 아니라면 신규 메두사 회원 가입 처리
    const currentUser = await fetch(
      `${process.env.BACKEND_URL}/users/users/${userId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: request.cookies.toString(),
        },
      }
    )
    if (!currentUser.ok) {
      return NextResponse.json(
        {
          success: false,
          error: "Current user not found",
        },
        { status: currentUser.status }
      )
    }

    const currentUserData = await currentUser.json()

    if (currentUserData.success) {
      try {
        await medusaSignup({
          email: currentUserData.data.email,
          first_name: currentUserData.data.username,
          last_name: currentUserData.data.username,
          almond_user_id: currentUserData.data.id,
          almond_login_id: currentUserData.data.loginId,
        })
      } catch (error) {
        console.error("medusaSignup error:", error)
        throw error
      }
    }

    // 메두사 회원 로그인 처리
    await medusaSignin()

    // 소셜 유저 동의 페이지로 리다이렉트
    const consentsRes = await getSocialUserConsentRedirectUrl(token!)
    if (!consentsRes) {
      return NextResponse.redirect(
        new URL(
          `/${countryCode}/consents?redirect_to=${redirectTo}`,
          request.url
        )
      )
    }

    return NextResponse.redirect(new URL(redirectTo, request.url))
  } catch (error) {
    console.error("Signup callback error:", error)
    const searchParams = request.nextUrl.searchParams
    const countryCode = searchParams.get("countryCode") ?? "kr"
    return NextResponse.redirect(
      new URL(`/${countryCode}/login?error=callback_failed`, request.url)
    )
  }
}

// 소셜 유저 동의 페이지로 리다이렉트
async function getSocialUserConsentRedirectUrl(token: string) {
  const response = await fetch(`${process.env.BACKEND_URL}/users/consents`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Cookie: token,
    },
  })

  if (!response.ok) {
    return null
  }

  const data = await response.json()

  return data.data
}
