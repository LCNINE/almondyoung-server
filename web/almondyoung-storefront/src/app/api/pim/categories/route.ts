import { NextRequest, NextResponse } from "next/server"

const PIM_BASE_URL =
  process.env.PIM_SERVICE_URL ||
  process.env.BACKEND_URL ||
  "http://localhost:3020"

/**
 * 카테고리 트리 조회
 * GET /api/pim/categories?maxDepth=2
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const maxDepth = searchParams.get("maxDepth")

    const url = new URL(`${PIM_BASE_URL}/categories`)
    if (maxDepth) {
      url.searchParams.append("maxDepth", maxDepth)
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { message: data.message || "카테고리 조회에 실패했습니다." },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("[PIM Categories API] Error:", error)
    return NextResponse.json(
      { message: "서버 오류가 발생했습니다." },
      { status: 500 }
    )
  }
}
