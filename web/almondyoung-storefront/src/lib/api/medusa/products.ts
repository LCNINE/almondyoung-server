"use server"

import { sdk } from "@/lib/config/medusa"
import { getAuthHeaders } from "@lib/data/cookies"
import { fetchCatalog } from "@lib/data/catalog-cache"
import type { HttpTypes } from "@medusajs/types"
import type { ProductSortBy, ProductSortOrder } from "@/lib/types/common/filter"
import { PRODUCT_LIST_TAG } from "@lib/data/cache-tags"
import { getRegion, retrieveRegion } from "./regions"

/**
 * handle 로 조회할 때 붙일 방문자 무관 캐시 태그.
 * `/api/revalidate` 가 `product-{handle}` 로 무효화하므로 문자열/배열 모두 태그를 걸어야 한다.
 */
// regionId 만 넘기는 호출부(홈 섹션 등)는 getRegion 이 일시 실패하면 undefined 를 넘긴다.
// 그때 throw 하면 섹션이 통째로 깨지므로 기본 지역으로 폴백해 재조회한다.
const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "kr"

const toProductHandleTags = (handle: unknown): string[] => {
  if (typeof handle === "string") return [`product-${handle}`]
  if (Array.isArray(handle)) {
    return handle
      .filter((h): h is string => typeof h === "string" && h.length > 0)
      .map((h) => `product-${h}`)
  }
  return []
}

export const getProductForQuickAdd = async (
  productId: string,
  countryCode: string
): Promise<HttpTypes.StoreProduct | null> => {
  const region = await getRegion(countryCode)
  if (!region) return null

  const headers = { ...(await getAuthHeaders()) }

  return sdk.client
    .fetch<{ products: HttpTypes.StoreProduct[] }>(`/store/products`, {
      method: "GET",
      query: {
        id: [productId],
        region_id: region.id,
        // +metadata: 멤버십 전용 구매 게이트 판정용. 빠지면 비회원에게도 담기가 열린다.
        fields:
          "*variants.calculated_price,+variants.inventory_quantity,*variants.options,+variants.manage_inventory,+variants.allow_backorder,+variants.metadata,*options,+metadata",
      },
      headers,
    })
    .then(({ products }) => products[0] ?? null)
    .catch(() => null)
}

export const listProducts = async ({
  pageParam = 1,
  queryParams,
  countryCode,
  regionId,
}: {
  pageParam?: number
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductListParams
  countryCode?: string
  regionId?: string
}): Promise<{
  response: { products: HttpTypes.StoreProduct[]; count: number }
  nextPage: number | null
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductListParams
}> => {
  if (!countryCode && !regionId) {
    countryCode = DEFAULT_REGION
  }

  const limit = queryParams?.limit || 12
  const _pageParam = Math.max(pageParam, 1)
  const offset = _pageParam === 1 ? 0 : (_pageParam - 1) * limit

  let region: HttpTypes.StoreRegion | undefined | null

  if (countryCode) {
    region = await getRegion(countryCode)
  } else {
    region = await retrieveRegion(regionId!)
  }

  if (!region) {
    return {
      response: { products: [], count: 0 },
      nextPage: null,
    }
  }

  // handle 조회엔 방문자 무관 태그를 더해 재고/가격 변경 시 revalidateTag 로 무효화한다.
  // 검색·카테고리는 handle 을 배열로 넘기므로 각각에 태그를 건다.
  const tags = [...toProductHandleTags(queryParams?.handle), PRODUCT_LIST_TAG]

  const { products, count } = await fetchCatalog<{
    products: HttpTypes.StoreProduct[]
    count: number
  }>({
    path: "/store/products",
    query: {
      limit,
      offset,
      region_id: region?.id,
      fields:
        "*variants.calculated_price,+variants.inventory_quantity,+variants.manage_inventory,+variants.allow_backorder,+variants.metadata,*variants.options,*variants.images,+metadata,+tags,",
      ...queryParams,
    },
    tags,
  })

  const nextPage = count > offset + limit ? pageParam + 1 : null

  return {
    response: { products, count },
    nextPage,
    queryParams,
  }
}

/**
 * 정렬된 상품 목록 조회 API
 * 서버의 /store/products-sorted 엔드포인트를 호출합니다.
 *
 * @param sortBy - 정렬 기준 (min_price, max_price, sales_count, review_count)
 * @param order - 정렬 순서 (asc, desc)
 */
export const listProductsSorted = async ({
  pageParam = 1,
  sortBy = "sales_count",
  order = "desc",
  countryCode,
  regionId,
  categoryId,
  collectionId,
  limit = 12,
}: {
  pageParam?: number
  sortBy?: ProductSortBy
  order?: ProductSortOrder
  countryCode?: string
  regionId?: string
  categoryId?: string[]
  collectionId?: string
  limit?: number
}): Promise<{
  response: { products: HttpTypes.StoreProduct[]; count: number }
  nextPage: number | null
}> => {
  if (!countryCode && !regionId) {
    countryCode = DEFAULT_REGION
  }

  const _pageParam = Math.max(pageParam, 1)
  const offset = _pageParam === 1 ? 0 : (_pageParam - 1) * limit

  let region: HttpTypes.StoreRegion | undefined | null

  if (countryCode) {
    region = await getRegion(countryCode)
  } else {
    region = await retrieveRegion(regionId!)
  }

  if (!region) {
    return {
      response: { products: [], count: 0 },
      nextPage: null,
    }
  }

  // 쿼리 파라미터 구성
  const query: Record<string, string | string[]> = {
    sort_by: sortBy,
    order,
    limit: String(limit),
    offset: String(offset),
    currency_code: region.currency_code,
    // region_id 가 빠지면 Medusa 쪽 가격 계산이 좁혀지지 않아 멤버십 price list 가
    // 비회원에게도 적용된다. 표준 /store/products 는 코어 미들웨어가 채우지만 이 라우트는
    // 직접 넘겨야 한다.
    region_id: region.id,
  }

  if (categoryId) {
    query.category_id = categoryId
  }

  if (collectionId) {
    query.collection_id = collectionId
  }

  const { products, count } = await fetchCatalog<{
    products: HttpTypes.StoreProduct[]
    count: number
  }>({
    path: "/store/products-sorted",
    query,
    tags: [PRODUCT_LIST_TAG],
  })

  const nextPage = count > offset + limit ? pageParam + 1 : null

  return {
    response: { products, count },
    nextPage,
  }
}
