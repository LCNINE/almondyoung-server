import { routeHandler } from "@lib/api/api-route-handler"
import { NextRequest, NextResponse } from "next/server"

export const POST = routeHandler(async (request: NextRequest) => {
  const { businessNumber, representativeName } = await request.json()
  const Cookies = request.cookies.toString()

  const response = await fetch(
    `${process.env.BACKEND_URL}/users/business-licenses/fetch`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: Cookies,
      },
      body: JSON.stringify({ businessNumber, representativeName }),
    }
  )

  const data = await response.json()

  if (!response.ok) {
    return NextResponse.json(
      {
        success: false,
        message: data.message || "Failed to fetch business info",
      },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
})
