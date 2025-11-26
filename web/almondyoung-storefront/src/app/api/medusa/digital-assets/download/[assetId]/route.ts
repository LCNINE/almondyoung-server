import { NextRequest, NextResponse } from "next/server"

export async function GET(
  request: NextRequest,
  { params }: { params: { assetId: string } }
) {
  const { assetId } = params

  const authorization = request.headers.get("authorization")

  const result = await fetch(
    `${process.env.BACKEND_URL}/medusa/store/library/${assetId}/download`,
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

  if (!result.ok) {
    const errorData = await result.json()
    return NextResponse.json(
      { success: false, error: errorData.error, message: errorData.message },
      { status: result.status }
    )
  }

  const blob = await result.blob()

  // Content-Disposition 헤더를 전달하여 파일명 유지
  const contentDisposition = result.headers.get("content-disposition")
  const headers: Record<string, string> = {
    "Content-Type":
      result.headers.get("content-type") || "application/octet-stream",
  }

  if (contentDisposition) {
    headers["Content-Disposition"] = contentDisposition
  }

  return new NextResponse(blob, {
    status: 200,
    headers,
  })
}
