import { medusaSignin } from "@lib/api/medusa/signin"
import { medusaSignup } from "@lib/api/medusa/signup"
import { appConfig } from "@/lib/config/medusa"
import { setTokenCookies } from "@lib/data/cookies"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const userId = searchParams.get("userId")
    const redirectTo =
      searchParams.get("redirect_to") ?? appConfig.auth.redirect_to

    if (!userId) {
      return NextResponse.redirect(new URL("/login", request.url))
    }

    // 토큰 받아오기
    const response = await fetch(
      `${process.env.BACKEND_URL}/users/auth/callback/signup`,
      {
        method: "POST",
        body: JSON.stringify({ userId }),
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
          message: result.message || "Callback signup failed",
        },
        { status: response.status }
      )
    }

    const result = await response.json()

    const { accessToken, refreshToken } = result.data

    setTokenCookies(accessToken, refreshToken)

    // 이미 메두사 회원인지 체크
    const medusaSigninResponse = await medusaSignin()

    if (medusaSigninResponse.success) {
      return NextResponse.redirect(new URL(redirectTo, request.url))
    }

    // 신규 회원 가입 처리
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
      const result = await medusaSignup({
        email: currentUserData.data.email,
        first_name: currentUserData.data.username,
        last_name: currentUserData.data.username,
        almond_user_id: currentUserData.data.id,
        almond_login_id: currentUserData.data.loginId,
      })

      if (!result.success) {
        console.error("medusaSignup failed:", result.error, result.message)
        return NextResponse.redirect(
          new URL("/login?error=signup_failed", request.url)
        )
      }
    }

    // 메두사 회원 로그인 처리
    await medusaSignin()

    // 콜백 페이지로 리다이렉트
    return NextResponse.redirect(new URL(redirectTo, request.url))
  } catch (error) {
    console.error("Signup callback error:", error)
    return NextResponse.redirect(
      new URL("/login?error=callback_failed", request.url)
    )
  }
}
