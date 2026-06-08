import { getRatingSummary } from "@/lib/api/ugc/reviews"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const productId = request.nextUrl.searchParams.get("productId")

  if (!productId) {
    return NextResponse.json(
      { message: "productId is required" },
      { status: 400 }
    )
  }

  try {
    const summary = await getRatingSummary(productId)
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json(
      { averageRating: 0, totalCount: 0, ratingDistribution: {} },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    )
  }
}
