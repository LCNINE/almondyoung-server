import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const data = await request.json()

  const response = await fetch(
    `${process.env.BACKEND_URL}/users/twilio/send-message`,
    {
      method: "POST",
      body: JSON.stringify({
        countryCode: data.countryCode,
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
        error: responseData.message || "Failed to send message",
      },
      { status: response.status }
    )
  }

  return NextResponse.json(responseData)
}
