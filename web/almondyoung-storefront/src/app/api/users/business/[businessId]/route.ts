import { revalidateTag } from "next/cache"
import { cookies as nextCookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ businessId: string }> }
) {
  const { businessId } = await params

  const businessData = await request.json()

  const cookieStore = await nextCookies()
  const cookieHeader = cookieStore.toString()

  const response = await fetch(
    `${process.env.BACKEND_URL}/users/business-licenses/${businessId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        ...businessData,
      }),
    }
  )

  const data = await response.json()

  if (!response.ok) {
    return NextResponse.json(
      {
        success: false,
        error: data.message || "Failed to update business",
      },
      { status: response.status }
    )
  }

  revalidateTag("business-info")

  return NextResponse.json(data)
}
