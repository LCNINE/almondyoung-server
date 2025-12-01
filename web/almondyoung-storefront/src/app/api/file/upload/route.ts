import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const cookies = request.cookies.toString()
  const formData = await request.formData()

  const response = await fetch(`${process.env.BACKEND_URL}/files/upload`, {
    method: "POST",
    body: formData,
    headers: {
      Cookie: cookies,
    },
  })

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
