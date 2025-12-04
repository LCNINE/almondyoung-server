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

// PIM API 쿼리 파라미터 매핑 함수
// 실제 PIM API는 쿼리 파라미터로 직접 전달
function buildPimQuery(params: ProductListParams) {
  return {
    page: params.page,
    limit: params.limit,
    status: params.query ? undefined : "active", // 검색이 아닐 때만 active 필터
    categoryId: params.categoryId,
    brand: params.brand,
    search: params.query, // 검색어는 search 파라미터로 전달
    // TODO: tags, stock 필터는 PIM API에서 지원하는지 확인 필요
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

    // API 응답 구조에 따라 items 또는 data 필드 사용
    const productItems = res.items || (res as any).data || []
    
    if (!Array.isArray(productItems)) {
      console.error(`❌ [getProductListService] items가 배열이 아님:`, typeof productItems, productItems)
      throw new Error(`Invalid API response: items is not an array`)
    }

    let items: ProductCard[] = productItems.map(toProductCard)

    // 정렬 처리 (클라이언트 사이드)
    if (params.sort) {
      const [field, order] = params.sort.split(":")
      if (field === "createdAt") {
        items.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return order === "desc" ? dateB - dateA : dateA - dateB
        })
      }
    }

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
  console.log(`🚀 [getProductsByCategoryService] 시작:`, { categoryId, params })
  
  try {
    // AbortSignal 처리
    const signal = opts instanceof AbortSignal ? opts : undefined

    // "all" 카테고리 ID인 경우 전체 상품 조회 (categoryId 필터 제외)
    const queryParams: {
      page?: number
      limit?: number
      status?: string
      categoryId?: string
    } = {
      page: params?.page,
      limit: params?.limit,
      status: "active", // active 상태만 조회
    }

    // "all"이 아닌 경우에만 categoryId 필터 추가
    if (categoryId !== "all") {
      queryParams.categoryId = categoryId
    }

    console.log(`📤 [getProductsByCategoryService] API 호출 파라미터:`, queryParams)

    const res = await getPimCategoryProducts(
      categoryId === "all" ? "" : categoryId,
      queryParams,
      signal
    )

    console.log(`📥 [getProductsByCategoryService] API 응답:`, { 
      itemCount: res.items?.length || 0, 
      total: res.total,
      responseType: Array.isArray(res) ? 'array' : 'object',
      hasItems: 'items' in res,
      hasData: 'data' in res,
      fullResponse: res,
    })

    // API 응답 구조에 따라 items 또는 data 필드 사용
    // 백엔드 응답이 {data: [...], total: 13} 형태일 수도 있음
    const productItems = res.items || (res as any).data || []
    
    if (!Array.isArray(productItems)) {
      console.error(`❌ [getProductsByCategoryService] items가 배열이 아님:`, typeof productItems, productItems)
      throw new Error(`Invalid API response: items is not an array`)
    }

    const items: ProductCard[] = productItems.map(toProductCard)

    console.log(`✅ [getProductsByCategoryService] 완료:`, { 
      itemCount: items.length, 
      total: res.total 
    })

    return { items, total: res.total, page: res.page, limit: res.limit }
  } catch (error) {
    console.error("❌ [getProductsByCategoryService] 에러:", error)
    // 실패 시에도 호출부가 안전하게 동작하도록 보수적 폴백
    return {
      items: [],
      total: 0,
      page: params?.page ?? 1,
      limit: params?.limit ?? 20,
    }
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
