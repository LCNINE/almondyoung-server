import { callbackSignup } from "@lib/api/users/callback-signup"
import { fetchUserByUserId } from "@lib/api/users/get-user"
import { appConfig } from "@lib/app-config"
import { setTokenCookies } from "@lib/data/cookies"
import { medusaSignup, retrieveCustomer } from "@lib/data/customer"
import { cookies } from "next/headers"
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
    const { accessToken, refreshToken } = await callbackSignup(userId)

    setTokenCookies(accessToken, refreshToken)

    // 이미 회원인지 체크
    const customer = await retrieveCustomer()
    if (customer) {
      return NextResponse.redirect(new URL(redirectTo, request.url))
    }

    // 신규 회원 가입 처리
    const currentUser = await fetchUserByUserId(userId)
    if (currentUser) {
      try {
        await medusaSignup({
          email: currentUser.email,
          first_name: currentUser.username,
          last_name: currentUser.username,
          almond_user_id: currentUser.id,
          almond_login_id: currentUser.loginId,
        })
      } catch (error) {
        console.error("medusaSignup error:", error)
        throw error
      }
    }

    // 콜백 페이지로 리다이렉트
    return NextResponse.redirect(
      new URL(
        `/callback/signup/process?redirect_to=${encodeURIComponent(redirectTo)}`,
        request.url
      )
    )
  } catch (error) {
    console.error("Signup callback error:", error)
    return NextResponse.redirect(
      new URL("/login?error=callback_failed", request.url)
    )
  }
}
