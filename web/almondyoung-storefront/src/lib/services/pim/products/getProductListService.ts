"use server"

import { getProductList } from "@lib/api/pim/masters.server"
import { toProductCard } from "@lib/utils/transformers"
import type {
  ProductCard,
  ProductListParams,
  ProductListServiceOpts,
  ProductListServiceResponse,
} from "@lib/types/ui/product"

// ---- 2) 기본 목록 서비스 ----
export async function getProductListService(
  params: ProductListParams,
  opts?: ProductListServiceOpts
): Promise<ProductListServiceResponse> {
  try {
    const result = await getProductList({
      page: params.page,
      limit: params.limit,
      mode: params.query ? undefined : "active",
      categoryId: params.categoryId,
      brand: params.brand,
      name: params.query,
    })

    if ("error" in result) {
      throw new Error(result.error.message)
    }

    const res = result.data
    const productItems = res.data || []

    if (!Array.isArray(productItems)) {
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

    return { items, total: res.total, page: res.page, limit: res.limit }
  } catch (e) {
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
): Promise<ProductListServiceResponse> {
  try {
    const result = await getProductList({
      page: params?.page,
      limit: params?.limit,
      mode: "active",
      categoryId: categoryId === "all" ? undefined : categoryId,
    })

    if ("error" in result) {
      throw new Error(result.error.message)
    }

    const res = result.data
    const productItems = res.data || []

    if (!Array.isArray(productItems)) {
      throw new Error(`Invalid API response: items is not an array`)
    }

    const items: ProductCard[] = productItems.map((dto) =>
      toProductCard(dto, "products/images")
    )

    return { items, total: res.total, page: res.page, limit: res.limit }
  } catch (error) {
    return {
      items: [],
      total: 0,
      page: params?.page ?? 1,
      limit: params?.limit ?? 20,
    }
  }
}

// ---- 4) 브랜드별 목록 ----
export async function getProductsByBrandService(
  brand: string,
  params?: Omit<ProductListParams, "brand" | "categoryId" | "query">,
  opts?: ProductListServiceOpts
): Promise<ProductListServiceResponse> {
  const result = await getProductList({
    page: params?.page,
    limit: params?.limit,
    brand,
    mode: "active",
  })

  if ("error" in result) {
    throw new Error(result.error.message)
  }

  const res = result.data
  const items = res.data.map(toProductCard)
  return { items, total: res.total, page: res.page, limit: res.limit }
}

type CachedPage = {
  items: ProductCard[]
  total: number
  page: number
  limit: number
}

const _cache: Map<string, CachedPage> = new Map()

// 페이지 단위로 캐싱하며, 짧은 TTL 적용 (선택)
export async function getProductListServiceCached(
  params: ProductListParams,
  opts?: ProductListServiceOpts
): Promise<ProductListServiceResponse> {
  const key = JSON.stringify({ params, opts })
  const cached = _cache.get(key)
  if (cached) return cached

  const result = await getProductListService(params, opts)
  _cache.set(key, result)

  // 5분 TTL
  setTimeout(() => _cache.delete(key), 5 * 60 * 1000)

  return result
}

/**
 * "인기 상품" 목록 조회
 * - 실제로는 백엔드에 "인기순" 필터가 있어야 하지만, 임시로 기본 목록을 반환
 * - TODO: 백엔드에 인기순 필터가 추가되면 해당 파라미터를 사용하도록 수정
 */
export async function getPopularProductsService(
  params?: Partial<ProductListParams>
): Promise<ProductListServiceResponse> {
  return getProductListService({
    ...params,
    page: params?.page ?? 1,
    limit: params?.limit ?? 10,
    sort: "createdAt:desc", // 임시로 최신순 사용
  })
}

/**
 * "신상품" 목록 조회
 * - createdAt 최신순
 */
export async function getNewProductsService(
  params?: Partial<ProductListParams>
): Promise<ProductListServiceResponse> {
  return getProductListService({
    ...params,
    page: params?.page ?? 1,
    limit: params?.limit ?? 10,
    sort: "createdAt:desc",
  })
}

/**
 * "베스트 상품" 목록 조회
 * - 실제로는 백엔드에 "판매량순" 필터가 있어야 함
 * - TODO: 백엔드에 판매량순 필터가 추가되면 해당 파라미터를 사용하도록 수정
 */
export async function getBestProductsService(
  params?: Partial<ProductListParams>
): Promise<ProductListServiceResponse> {
  return getProductListService({
    ...params,
    page: params?.page ?? 1,
    limit: params?.limit ?? 10,
    sort: "createdAt:desc", // 임시로 최신순 사용
  })
}
