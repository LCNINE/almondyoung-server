import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const cookies = request.cookies.toString()

  const response = await fetch(`${process.env.BACKEND_URL}/users/consents`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
    },
  })

  const data = await response.json()

  if (!response.ok) {
    return NextResponse.json(
      {
        success: false,
        error: data.message || "Failed to get consents",
      },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const cookies = request.cookies.toString()
  const data = await request.json()

  const response = await fetch(`${process.env.BACKEND_URL}/users/consents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies.toString(),
    },
    body: JSON.stringify(data),
  })

  const responseData = await response.json()
  if (!response.ok) {
    return NextResponse.json(
      {
        success: false,
        error: responseData.message || "Failed to create consents",
      },
      { status: response.status }
    )
  }

  return NextResponse.json(responseData)
}
