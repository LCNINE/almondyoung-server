import { cookies as nextCookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const formData = await request.formData()

  const cookieStore = await nextCookies()
  const cookieHeader = cookieStore.toString()

  const response = await fetch(
    `${process.env.BACKEND_URL}/fs/api/v1/files/upload`,
    {
      method: "POST",
      body: formData,
      headers: {
        Cookie: cookieHeader,
      },
    }
  )

  const data = await response.json()
  if (!response.ok) {
    return NextResponse.json(
      {
        success: false,
        error: data.message || "Failed to upload file",
      },
      { status: response.status }
    )
  }

  return NextResponse.json({
    success: response.ok,
    data: data,
  })
}
