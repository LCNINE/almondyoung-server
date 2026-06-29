import { sdk } from "@/lib/config/medusa"
import { siteConfig } from "@/lib/config/site"
import { MetadataRoute } from "next"

// 검색엔진용 전체 URL 목록. countryCode 기본 region(kr) 기준.
// medusa store API 를 직접 호출한다 (listProducts/getRegion 래퍼는 cookies 에 의존해
// 라우트를 dynamic 으로 강제 → 매 요청 1만건 실시간 생성 → 504. 여기선 cookies 를 안 거쳐
// force-static + ISR 로 빌드/주기 재생성하므로 런타임 timeout 이 없다).
export const dynamic = "force-static"
export const revalidate = 86400 // 하루 1회 백그라운드 재생성

const REGION = "kr"
const PAGE_SIZE = 1000
// ponytail: 6만개 상한(현재 ~1만). 넘으면 잘리므로 warn + generateSitemaps 로 분할할 것.
const MAX_PAGES = 60

async function getProductHandles(): Promise<string[]> {
  const handles: string[] = []
  let offset = 0

  for (let i = 0; i < MAX_PAGES; i++) {
    const { products, count } = await sdk.client.fetch<{
      products: { handle?: string }[]
      count: number
    }>("/store/products", {
      query: { limit: PAGE_SIZE, offset, fields: "handle" },
    })

    for (const p of products) if (p.handle) handles.push(p.handle)

    offset += PAGE_SIZE
    if (offset >= count) return handles
  }

  console.warn(
    `[sitemap] 상품이 ${MAX_PAGES * PAGE_SIZE}개 상한에 도달해 일부 누락 — sitemap 분할 필요`
  )
  return handles
}

async function getCategoryHandles(): Promise<string[]> {
  // /store/product-categories 는 전체 카테고리를 flat 으로 반환(현재 329개 < limit).
  const { product_categories } = await sdk.client.fetch<{
    product_categories: { handle?: string }[]
  }>("/store/product-categories", {
    query: { limit: 1000, fields: "handle" },
  })

  return product_categories
    .map((c) => c.handle)
    .filter((h): h is string => Boolean(h))
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = `https://${siteConfig.domainName}`
  const now = new Date()

  const [productHandles, categoryHandles] = await Promise.all([
    getProductHandles().catch(() => [] as string[]),
    getCategoryHandles().catch(() => [] as string[]),
  ])

  const uniqueCategories = Array.from(new Set(categoryHandles))
  const uniqueProducts = Array.from(new Set(productHandles))

  const entry = (
    path: string,
    changeFrequency: "daily" | "weekly",
    priority: number
  ) => ({
    url: `${base}/${REGION}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  })

  const staticEntries: MetadataRoute.Sitemap = [
    entry("", "daily", 1),
    entry("/best", "weekly", 0.8),
    entry("/new", "weekly", 0.8),
    entry("/cs", "weekly", 0.5),
  ]

  return [
    ...staticEntries,
    ...uniqueCategories.map((h) => entry(`/category/${h}`, "weekly", 0.7)),
    ...uniqueProducts.map((h) => entry(`/products/${h}`, "weekly", 0.6)),
  ]
}
