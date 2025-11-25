import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization")

    const res = await fetch(
      `${process.env.BACKEND_URL}/medusa/auth/customer/my-auth`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authorization && { authorization }),
        },
      }
    )

    const result = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          message: result.message || "Medusa login failed",
        },
        { status: res.status }
      )
    }

    const response = NextResponse.json({ success: true, token: result.token })

    return response
  } catch (error: any) {
    console.log("error:", error)
    return NextResponse.json(
      { success: false, error: error.toString() },
      { status: 500 }
    )
  }
}
