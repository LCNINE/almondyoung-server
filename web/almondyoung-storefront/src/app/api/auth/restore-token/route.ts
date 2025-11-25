import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"

export async function POST(request: NextRequest) {
  try {
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

      response.cookies.delete("accessToken")
      response.cookies.delete("refreshToken")
      response.cookies.delete("_medusa_jwt")

      return response
    }

    const res = await fetch(
      `${process.env.BACKEND_URL}/users/auth/restore-token`,
      {
        method: "POST",
        headers: {
          Cookie: `refreshToken=${refreshToken}`,
        },
        credentials: "include",
      }
    )

    if (!res.ok) {
      throw new Error("Restore token failed!!")
    }

    const data = await res.json()

    // 토큰 복구 성공 - JSON 응답으로 처리
    const response = NextResponse.json(
      {
        success: true,
        message: "Token restored successfully",
      },
      { status: 200 }
    )

    response.cookies.set("accessToken", data.data.accessToken)

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

    response.cookies.delete("accessToken")
    response.cookies.delete("refreshToken")
    response.cookies.delete("_medusa_jwt")

    return response
  }
}
