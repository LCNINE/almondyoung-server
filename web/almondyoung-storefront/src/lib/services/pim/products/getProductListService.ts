// services/pim/products/getProductListService.ts

import {
  getPimCategoryProducts,
  getPimProductDetail,
  getAllProductList,
} from "@lib/api/pim/pim-api"
import {
  toProductCard,
  toProductDetail,
} from "@lib/utils/transformers/product.transformer"
import type { ProductCard, ProductDetail } from "@lib/types/ui/product"
import { ProductDetailServiceOpts } from "./getProductDetailService"

// ---- 1) 목록 파라미터/옵션 타입 ----
export interface ProductListParams {
  page?: number
  limit?: number
  sort?: string
  query?: string
  categoryId?: string
  brand?: string
  tags?: string[]
  stock?: string[] // ex) ["in_stock", "low_stock"]
}

export interface ProductListServiceOpts {
  userId?: string
  withStock?: boolean
  withReview?: boolean
}

// PIM API가 filters.* 형태를 기대한다고 가정한 매핑 함수
function buildPimQuery(params: ProductListParams) {
  const {
    page = 1,
    limit = 24,
    sort,
    query,
    categoryId,
    brand,
    tags,
    stock,
  } = params

  // 백엔드 스펙에 맞춰 filters 객체로 묶어 전달
  const filters: Record<string, unknown> = {}
  if (categoryId) filters.categoryId = categoryId
  if (brand) filters.brand = brand
  if (tags?.length) filters.tags = tags
  if (stock?.length) filters.stock = stock

  return {
    page,
    limit,
    sort,
    query,
    filters,
  }
}

// ---- 2) 기본 목록 서비스 ----
export async function getProductListService(
  params: ProductListParams,
  opts?: ProductListServiceOpts
): Promise<{
  items: ProductCard[]
  total: number
  page: number
  limit: number
}> {
  try {
    const pimParams = buildPimQuery(params)
    const res = await getAllProductList(pimParams)

    const items: ProductCard[] = res.items.map(toProductCard)

    // ▼ 확장 포인트 (필요 시 주석 해제)
    // const [reviewMap, stockMap, userMetaMap] = await Promise.all([
    //   opts?.withReview && items.length ? getPimReviewSummaryBulk(items.map(i => i.id)) : Promise.resolve(null),
    //   opts?.withStock  && items.length ? getInventorySummaries(items.map(i => i.id))  : Promise.resolve(null),
    //   opts?.userId     && items.length ? getUserProductMetaBulk({ userId: opts.userId, productIds: items.map(i => i.id) }) : Promise.resolve(null),
    // ])

    // if (reviewMap) {
    //   for (const it of items) {
    //     const s = reviewMap[it.id]
    //     if (s) {
    //       it.rating = s.rating
    //       it.reviewCount = s.reviewCount
    //       it.qnaCount = s.qnaCount
    //     }
    //   }
    // }
    // if (stockMap) {
    //   for (const it of items) it.stock = stockMap[it.id]
    // }
    // if (userMetaMap) {
    //   for (const it of items) it.userMeta = userMetaMap[it.id]
    // }

    return { items, total: res.total, page: res.page, limit: res.limit }
  } catch (e) {
    // 실패 시에도 호출부가 안전하게 동작하도록 보수적 폴백
    return {
      items: [],
      total: 0,
      page: params.page ?? 1,
      limit: params.limit ?? 24,
    }
  }
}

// ---- 3) 카테고리별 목록 ----
export async function getProductsByCategoryService(
  categoryId: string,
  params?: Omit<ProductListParams, "categoryId" | "brand" | "query">,
  opts?: ProductListServiceOpts | AbortSignal
): Promise<{
  items: ProductCard[]
  total: number
  page: number
  limit: number
}> {
  try {
    // 🎭 임시: Mock 데이터 반환 (API 연동 전까지)
    // import는 상단에서 처리
    const skinProducts = await import("@lib/data/dummy/get-skin-list.json")
    const mockData = skinProducts.default || skinProducts

    const page = params?.page || 1
    const limit = params?.limit || 20
    const startIndex = (page - 1) * limit
    const items = mockData.data.slice(
      startIndex,
      startIndex + limit
    ) as ProductCard[]

    return {
      items,
      total: mockData.data.length,
      page,
      limit,
    }

    /* 실제 API 호출 코드 (주석 처리)
    // AbortSignal 처리
    const signal = opts instanceof AbortSignal ? opts : undefined
    
    // "all" 카테고리 ID인 경우 전체 상품 조회 (categoryId 필터 제외)
    const queryParams: any = {
      page: params?.page,
      limit: params?.limit,
      sort: params?.sort,
      tags: params?.tags,
      stock: params?.stock,
    }
    
    // "all"이 아닌 경우에만 categoryId 필터 추가
    if (categoryId !== "all") {
      queryParams.categoryId = categoryId
    }
    
    const res = await getAllProductList(queryParams, signal)
    
    const items = res.items.map(toProductCard)
    
    return { items, total: res.total, page: res.page, limit: res.limit }
    */
  } catch (error) {
    console.error("❌ [getProductsByCategoryService] 에러:", error)
    throw error
  }
}

// ---- 4) 브랜드별 목록 ----
// PIM이 brand 필터를 지원한다면 brand로, 아니면 query fallback.
export async function getProductsByBrandService(
  brand: string,
  params?: Omit<ProductListParams, "brand" | "categoryId" | "query">,
  opts?: ProductListServiceOpts
) {
  const res = await getAllProductList({
    page: params?.page,
    limit: params?.limit,
    sort: params?.sort,
    brand,
  })
  const items = res.items.map(toProductCard)
  return { items, total: res.total, page: res.page, limit: res.limit }
}

type CachedPage = {
  items: ProductCard[]
  total: number
  etag?: string
  lastFetched: number // ms
}

const LS_KEY = (id: string, sort: string, limit: number) =>
  `cat:${id}:sort=${sort}:limit=${limit}`

export function readCache(
  categoryId: string,
  sort: string,
  limit: number
): CachedPage | null {
  try {
    const raw = localStorage.getItem(LS_KEY(categoryId, sort, limit))
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeCache(
  categoryId: string,
  sort: string,
  limit: number,
  data: CachedPage
) {
  try {
    localStorage.setItem(LS_KEY(categoryId, sort, limit), JSON.stringify(data))
  } catch {
    /* ignore quota */
  }
}
