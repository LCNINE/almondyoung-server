import { NextRequest, NextResponse } from "next/server"
import legacyMap from "@/lib/seo/cafe24-legacy-map.json"

const REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "kr"
const products = legacyMap.products as Record<string, string>
const categories = new Set(legacyMap.categories as string[])

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind")
  const value = request.nextUrl.searchParams.get("value")

  const target = kind && value ? resolve(kind, value) : undefined
  if (!target) return new NextResponse("Not Found", { status: 404 })

  return NextResponse.redirect(new URL(target, request.nextUrl.origin), 301)
}

function resolve(kind: string, value: string): string | undefined {
  if (kind === "product") {
    const masterId = products[value]
    return masterId && `/${REGION}/products/${masterId}`
  }
  if (kind === "category") {
    return categories.has(value)
      ? `/${REGION}/category/cafe24-cat-${value}`
      : undefined
  }
  if (kind === "search") {
    return `/${REGION}/search?q=${encodeURIComponent(value)}`
  }
  return undefined
}
