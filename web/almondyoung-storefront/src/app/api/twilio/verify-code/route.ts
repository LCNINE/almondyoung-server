import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const data = await request.json()

  const response = await fetch(
    `${process.env.BACKEND_URL}/users/twilio/verify-code`,
    {
      method: "POST",
      body: JSON.stringify({
        code: data.code,
        phoneNumber: data.phoneNumber,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    }
  )

  const responseData = await response.json()

  if (!response.ok) {
    return NextResponse.json(
      {
        success: false,
        error: responseData.message || "Failed to verify code",
      },
      { status: response.status }
    )
  }

  return NextResponse.json(responseData)
}
