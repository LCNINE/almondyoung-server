import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const redirectTo = searchParams.get("redirect_to") || "/"

    const data = await request.json()

    const backendUrl = `${process.env.BACKEND_URL}/users/auth/signup?redirect_to=${redirectTo}`

    const response = await fetch(backendUrl, {
      method: "POST",
      body: JSON.stringify(data),
      headers: {
        "Content-Type": "application/json",
      },
    })

    const responseData = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        responseData.message || "회원가입에 실패했습니다.",
        { status: response.status }
      )
    }

    return NextResponse.json(responseData)
  } catch (error) {
    console.error("API Route Error:", error)
    return NextResponse.json("서버 오류가 발생했습니다.", { status: 500 })
  }
}
