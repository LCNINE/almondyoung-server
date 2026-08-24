import { NextRequest, NextResponse } from "next/server"
import legacyMap from "@/lib/seo/cafe24-legacy-map.json"
import { parseCafe24LegacyUrl } from "@/lib/seo/cafe24-legacy-url"

const REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "kr"
const products = legacyMap.products as Record<string, string>
const categories = new Set(legacyMap.categories as string[])

// rewrite 로 넘어와도 nextUrl 은 원본 cafe24 URL 이라 여기서 다시 파싱한다.
export async function GET(request: NextRequest) {
  const legacy = parseCafe24LegacyUrl(
    request.nextUrl.pathname,
    request.nextUrl.searchParams
  )
  const target = legacy && resolve(legacy.kind, legacy.value)
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
