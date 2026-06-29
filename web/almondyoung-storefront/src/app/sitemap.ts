import { listCategories } from "@/lib/api/medusa/categories"
import { listProducts } from "@/lib/api/medusa/products"
import { siteConfig } from "@/lib/config/site"
import { HttpTypes } from "@medusajs/types"
import { MetadataRoute } from "next"

// 검색엔진에 노출할 전체 URL 목록. countryCode 기본 region(kr) 기준.
// - 정적 진입점(홈/베스트/신상/고객센터)
// - 전체 카테고리: /category/{handle}  (라우트가 마지막 handle 만으로 조회 → 단일 세그먼트가 곧 canonical)
// - 전체 상품: /products/{handle}
const REGION = "kr"
const PRODUCT_PAGE_SIZE = 1000
// ponytail: 6만개 상한(현재 ~1만). 넘으면 잘리므로 아래에서 warn + sitemap 5만 URL 한도도 그 즈음 도달 → generateSitemaps 로 분할할 것.
const MAX_PRODUCT_PAGES = 60

async function getAllProductHandles(): Promise<string[]> {
  const handles: string[] = []
  let page = 1

  while (page <= MAX_PRODUCT_PAGES) {
    const { response, nextPage } = await listProducts({
      pageParam: page,
      countryCode: REGION,
      queryParams: { limit: PRODUCT_PAGE_SIZE, fields: "handle" },
    })

    for (const product of response.products) {
      if (product.handle) handles.push(product.handle)
    }

    if (!nextPage) return handles
    page = nextPage
  }

  console.warn(
    `[sitemap] 상품이 ${MAX_PRODUCT_PAGES * PRODUCT_PAGE_SIZE}개 상한에 도달해 일부가 누락됨 — sitemap 분할 필요`
  )
  return handles
}

function collectCategoryHandles(
  categories: HttpTypes.StoreProductCategory[]
): string[] {
  const out: string[] = []

  const walk = (nodes: HttpTypes.StoreProductCategory[]) => {
    for (const node of nodes) {
      if (node.handle) out.push(node.handle)
      if (node.category_children?.length) walk(node.category_children)
    }
  }

  walk(categories)
  return out
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = `https://${siteConfig.domainName}`
  const now = new Date()

  const [productHandles, categories] = await Promise.all([
    getAllProductHandles().catch(() => [] as string[]),
    listCategories({ limit: 1000 }).catch(
      () => [] as HttpTypes.StoreProductCategory[]
    ),
  ])

  const categoryHandles = Array.from(
    new Set(collectCategoryHandles(categories))
  )
  const uniqueProductHandles = Array.from(new Set(productHandles))

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
    ...categoryHandles.map((h) => entry(`/category/${h}`, "weekly", 0.7)),
    ...uniqueProductHandles.map((h) => entry(`/products/${h}`, "weekly", 0.6)),
  ]
}
