import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const data = await request.json()

  const response = await fetch(
    `${process.env.BACKEND_URL}/users/auth/forget-userid`,
    {
      method: "POST",
      body: JSON.stringify(data),
      headers: {
        Cookie: request.cookies.toString(),
        "Content-Type": "application/json",
      },
    }
  )

  const result = await response.json()
  if (!response.ok) {
    return NextResponse.json(result, { status: response.status })
  }

  return NextResponse.json(result)
}
