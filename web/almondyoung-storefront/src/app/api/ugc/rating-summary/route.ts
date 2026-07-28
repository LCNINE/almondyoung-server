import { getRatingSummaries, getRatingSummary } from "@/lib/api/ugc/reviews"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

export async function GET(request: NextRequest) {
  const productIds = request.nextUrl.searchParams.get("productIds")

  // 목록(카드 그리드)용 배치 경로. 단건 경로는 별점 분포가 필요한 상세 화면이 계속 쓴다.
  if (productIds) {
    const ids = productIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)

    if (ids.length === 0) {
      return NextResponse.json({ summaries: [] }, { headers: NO_STORE })
    }

    try {
      const summaries = await getRatingSummaries(ids)
      return NextResponse.json({ summaries }, { headers: NO_STORE })
    } catch {
      // 평점은 부가 정보라 실패해도 카드 자체는 그려져야 한다.
      return NextResponse.json(
        { summaries: [] },
        { status: 200, headers: NO_STORE }
      )
    }
  }

  const productId = request.nextUrl.searchParams.get("productId")

  if (!productId) {
    return NextResponse.json(
      { message: "productId or productIds is required" },
      { status: 400 }
    )
  }

  try {
    const summary = await getRatingSummary(productId)
    return NextResponse.json(summary, { headers: NO_STORE })
  } catch {
    return NextResponse.json(
      { averageRating: 0, totalCount: 0, ratingDistribution: {} },
      { status: 200, headers: NO_STORE }
    )
  }
}
