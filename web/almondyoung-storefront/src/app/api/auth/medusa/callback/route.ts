import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization")

    if (!authHeader) {
      return NextResponse.json(
        {
          success: false,
          error: "Authorization 헤더가 없습니다",
          message: "Authorization 헤더가 없습니다",
        },
        { status: 401 }
      )
    }

    const res = await fetch(
      `${process.env.MEDUSA_BACKEND_URL}/auth/user/my-auth/callback`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
      }
    )

    if (!res.ok) {
      const errorData = await res.text()

      return NextResponse.json(
        {
          success: false,
          error: "Medusa Authentication failed",
          message: "Medusa Authentication failed",
          details: errorData,
        },
        { status: res.status || 401 }
      )
    }

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error("Medusa Login error:", error)

    return NextResponse.json(
      {
        success: false,
        error: "서버 오류가 발생했습니다",
        message: "서버 오류가 발생했습니다",
      },
      { status: 500 }
    )
  }
}
