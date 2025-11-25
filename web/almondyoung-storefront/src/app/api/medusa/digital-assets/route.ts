import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  const skip = searchParams.get("skip")
  const take = searchParams.get("take")

  const authorization = request.headers.get("authorization")

  const result = await fetch(
    `${process.env.BACKEND_URL}/medusa/store/library?skip=${skip}&take=${take}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(authorization && { authorization }),
        "x-publishable-api-key":
          process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
      },
    }
  )

  const resultData = await result.json()

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: resultData.error, message: resultData.message },
      { status: result.status }
    )
  }

  return NextResponse.json({ success: true, data: resultData })
}

export async function POST(request: NextRequest) {
  const { assetId } = await request.json()

  const authorization = request.headers.get("authorization")

  const result = await fetch(
    `${process.env.BACKEND_URL}/medusa/store/library/${assetId}/exercise`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization && { authorization }),
        "x-publishable-api-key":
          process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
      },
    }
  )

  const resultData = await result.json()

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: resultData.error, message: resultData.message },
      { status: result.status }
    )
  }

  return NextResponse.json({ success: true, data: resultData })
}
