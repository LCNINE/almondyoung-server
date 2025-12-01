import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const cookies = request.cookies.toString()

  const business = await fetch(
    `${process.env.BACKEND_URL}/users/business-licenses/me`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookies,
      },
      next: {
        tags: ["business-info"],
      },
    }
  )

  const businessData = await business.json()

  if (!business.ok) {
    return NextResponse.json(
      {
        success: false,
        error: businessData.message || "Failed to get business",
      },
      { status: business.status }
    )
  }

  return NextResponse.json(businessData)
}
