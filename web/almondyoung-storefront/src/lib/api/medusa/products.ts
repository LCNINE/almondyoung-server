"use server"

import { sdk } from "@/lib/config/medusa"
import { getAuthHeaders, getCacheOptions } from "@lib/data/cookies"
import type { HttpTypes } from "@medusajs/types"
import type { ProductSortOption } from "@/lib/types/common/filter"
import { getRegion, retrieveRegion } from "./regions"

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
    throw new Error("Country code or region ID is required")
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

  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("products")),
  }

  return sdk.client
    .fetch<{ products: HttpTypes.StoreProduct[]; count: number }>(
      `/store/products`,
      {
        method: "GET",
        query: {
          limit,
          offset,
          region_id: region?.id,
          fields:
            "*variants.calculated_price,+variants.inventory_quantity,*variants.images,+metadata,+tags,",
          ...queryParams,
        },
        headers,
        next,
        cache: "force-cache",
      }
    )
    .then(({ products, count }) => {
      const nextPage = count > offset + limit ? pageParam + 1 : null

      return {
        response: {
          products,
          count,
        },
        nextPage: nextPage,
        queryParams,
      }
    })
}

/**
 * 정렬된 상품 목록 조회 API
 * 서버의 /store/products-sorted 엔드포인트를 호출합니다.
 *
 * @param sort - 정렬 옵션 (created_at, price_asc, price_desc, sales_desc)
 */
export const listProductsSorted = async ({
  pageParam = 1,
  sort = "created_at",
  countryCode,
  regionId,
  categoryIds,
  collectionIds,
  productIds,
  limit = 12,
}: {
  pageParam?: number
  sort?: ProductSortOption
  countryCode?: string
  regionId?: string
  categoryIds?: string[]
  collectionIds?: string[]
  productIds?: string[]
  limit?: number
}): Promise<{
  response: { products: HttpTypes.StoreProduct[]; count: number }
  nextPage: number | null
}> => {
  if (!countryCode && !regionId) {
    throw new Error("Country code or region ID is required")
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

  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("products")),
  }

  // 쿼리 파라미터 구성
  const query: Record<string, string | string[]> = {
    sort,
    limit: String(limit),
    offset: String(offset),
    region_id: region.id,
    fields:
      "*variants.calculated_price,+variants.inventory_quantity,*variants.images,+metadata,+tags,",
  }

  if (categoryIds?.length) {
    query.category_id = categoryIds
  }

  if (collectionIds?.length) {
    query.collection_id = collectionIds
  }

  if (productIds?.length) {
    query.id = productIds
  }

  return sdk.client
    .fetch<{
      products: HttpTypes.StoreProduct[]
      count: number
      offset?: number
      limit?: number
    }>(`/store/products-sorted`, {
      method: "GET",
      query,
      headers,
      next,
      cache: "force-cache",
    })
    .then(({ products, count }) => {
      const nextPage = count > offset + limit ? pageParam + 1 : null

      return {
        response: {
          products,
          count,
        },
        nextPage,
      }
    })
}
