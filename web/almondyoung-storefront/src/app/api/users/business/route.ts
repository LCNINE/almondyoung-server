import { revalidatePath, revalidateTag } from "next/cache"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const businessData = await request.json()

  const cookies = request.cookies.toString()

  const response = await fetch(
    `${process.env.BACKEND_URL}/users/business-licenses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookies,
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
        error: data.message || "Failed to create business",
      },
      { status: response.status }
    )
  }

  revalidateTag("business-info")
  revalidatePath("/mypage/business")

  return NextResponse.json(data)
}
