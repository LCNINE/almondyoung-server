"use server"

import { sdk } from "@/lib/config/medusa"
import { getAuthHeaders, getCacheOptions } from "@lib/data/cookies"
import type { HttpTypes, StoreProduct } from "@medusajs/types"
import { getRegion, retrieveRegion } from "./regions"
import { SortOptions } from "@/domains/category/components/refinement-list/sort-products"
import { sortProducts } from "@/lib/utils/sort-products"

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

// export const listProducts2 = async ({
//   pageParam = 1,
//   queryParams,
//   countryCode,
//   regionId,
//   fetchOptions,
// }: {
//   pageParam?: number
//   queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductListParams
//   countryCode?: string
//   regionId?: string
//   fetchOptions?: {
//     cache?: RequestCache
//     revalidate?: number
//   }
// }): Promise<{
//   response: { products: HttpTypes.StoreProduct[]; count: number }
//   nextPage: number | null
//   queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductListParams
// }> => {
//   if (!countryCode && !regionId) {
//     throw new Error("Country code or region ID is required")
//   }

//   const limit = queryParams?.limit || 12
//   const _pageParam = Math.max(pageParam, 1)
//   const offset = _pageParam === 1 ? 0 : (_pageParam - 1) * limit

//   let region: HttpTypes.StoreRegion | undefined | null

//   if (countryCode) {
//     region = await getRegion(countryCode)
//   } else {
//     region = await retrieveRegion(regionId!)
//   }

//   if (!region) {
//     return {
//       response: { products: [], count: 0 },
//       nextPage: null,
//     }
//   }

//   const headers = {
//     ...(await getAuthHeaders()),
//   }

//   const cacheMode = fetchOptions?.cache ?? "force-cache"
//   const next =
//     cacheMode === "no-store"
//       ? undefined
//       : {
//           ...(await getCacheOptions("products")),
//           revalidate: fetchOptions?.revalidate ?? 300,
//         }

//   const query = {
//     limit,
//     offset,
//     region_id: region?.id,
//     fields:
//       "*variants.calculated_price,+variants.inventory_quantity,*variants.images,*variants.options,+variants.metadata,*options,*options.values,+metadata,*tags,",
//     ...queryParams,
//   }

//   const requestOptions = {
//     method: "GET" as const,
//     query,
//     headers,
//     next,
//     cache: cacheMode,
//   }

//   const toResult = (products: HttpTypes.StoreProduct[], count: number) => {
//     const nextPage = count > offset + limit ? pageParam + 1 : null

//     return {
//       response: {
//         products,
//         count,
//       },
//       nextPage,
//       queryParams,
//     }
//   }

//   const membershipResponse = await sdk.client
//     .fetch<{ products: HttpTypes.StoreProduct[]; count: number }>(
//       `/store/membership-products`,
//       requestOptions
//     )
//     .catch(() => null)

//   if (membershipResponse && membershipResponse.count > 0) {
//     return toResult(membershipResponse.products, membershipResponse.count)
//   }

//   // 서버 커스텀 라우트 장애 시에도 목록이 완전히 비지 않도록 fallback.
//   const fallbackResponse = await sdk.client.fetch<{
//     products: HttpTypes.StoreProduct[]
//     count: number
//   }>(`/store/products`, requestOptions)

//   const customer = await retrieveCustomer().catch(() => null)
//   const isMember = isMembershipGroup(customer?.groups)

//   const filteredProducts = isMember
//     ? fallbackResponse.products
//     : fallbackResponse.products.filter((product) => !isMembershipOnlyProduct(product))

//   const removedCount = fallbackResponse.products.length - filteredProducts.length
//   const adjustedCount = Math.max(0, fallbackResponse.count - removedCount)

//   return toResult(filteredProducts, adjustedCount)
// }

/**
 * Next.js 캐시에 100개 상품을 가져와 sortBy 파라미터 기준으로 정렬합니다.
 * 그 후 page와 limit 파라미터에 따라 페이지네이션된 상품을 반환합니다.
 */
export const listProductsWithSort = async ({
  page = 0,
  queryParams,
  sortBy = "created_at",
  countryCode,
}: {
  page?: number
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductParams
  sortBy?: SortOptions
  countryCode: string
}): Promise<{
  response: { products: HttpTypes.StoreProduct[]; count: number }
  nextPage: number | null
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductParams
}> => {
  const limit = queryParams?.limit || 12

  const {
    response: { products, count },
  } = await listProducts({
    pageParam: 0,
    queryParams: {
      ...queryParams,
      limit: 100,
    },
    countryCode,
  })

  const sortedProducts = sortProducts(products, sortBy)

  const pageParam = (page - 1) * limit

  const nextPage = count > pageParam + limit ? pageParam + limit : null

  const paginatedProducts = sortedProducts.slice(pageParam, pageParam + limit)

  return {
    response: {
      products: paginatedProducts,
      count,
    },
    nextPage,
    queryParams,
  }
}

// 상품 상세 조회
export const getProductDetail = async (
  productId: string,
  regionId?: string
  // salesChannelId?: string | null
): Promise<StoreProduct> => {
  try {
    const authHeaders = await getAuthHeaders()

    const { product } = await sdk.store.product.retrieve(
      productId,
      {
        fields:
          "variants.*,+variants.inventory_quantity,+variants.manage_inventory,+variants.metadata,+variants.prices.*,+variants.calculated_price",
        region_id: regionId,
      },
      {
        ...authHeaders,
        cache: "no-store",
      }
    )

    return product
  } catch (error) {
    console.error("상품 상세 조회 실패:", error)
    throw error
  }
}
