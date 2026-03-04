"use server"

import { sdk } from "@/lib/config/medusa"
import { getAuthHeaders, getCacheOptions } from "@lib/data/cookies"
import type { ProductsResponseDto } from "@lib/types/dto/medusa"
import type { HttpTypes, StoreProduct } from "@medusajs/types"
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
            "*variants.calculated_price,+variants.inventory_quantity,*variants.images,*variants.options,+variants.metadata,*options,*options.values,+metadata,+tags,",
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

interface GetProductListParams {
  page?: number
  limit?: number
  categoryId?: string | string[]
  region_id?: string
  handle?: string[] | string
  id?: string[] | string
  q?: string // 검색어 파라미터 추가
  order?: string // 정렬 파라미터 (예: "created_at", "-created_at", "title", "-title")
  includeFullVariants?: boolean
}

// 상품 목록 조회
export const getProductList = async ({
  page = 1,
  limit = 10,
  categoryId,
  region_id,
  handle,
  id,
  q,
  order,
  includeFullVariants = false,
}: GetProductListParams): Promise<ProductsResponseDto> => {
  const offset = (page - 1) * limit

  try {
    const {
      products,
      count,
      limit: resLimit,
    } = await sdk.store.product.list(
      {
        limit,
        offset,
        category_id: categoryId,
        handle,
        id,
        q, // 검색어 전달
        order, // 정렬 (예: "-created_at" = 최신순)
        fields:
          "*variants.calculated_price,+variants.inventory_quantity,+variants.manage_inventory,+variants.metadata,+variants.prices.*,+variants.calculated_price_incl_tax,+variants.original_price,+variants.original_price_incl_tax,+categories,+metadata,+tags",
        region_id: region_id,
      },
      {
        cache: "no-store",
        next: {
          tags: [
            "products",
            Array.isArray(categoryId) ? categoryId.join(",") : categoryId || "",
          ],
        },
      }
    )

    const productsWithFullVariants =
      includeFullVariants && products.length > 0
        ? await Promise.all(
            products.map(async (product) => {
              try {
                const detailed = await getProductDetail(product.id, region_id)
                if (!detailed?.variants?.length) {
                  return product
                }
                return {
                  ...product,
                  variants: detailed.variants,
                }
              } catch {
                return product
              }
            })
          )
        : products

    const totalPages = Math.ceil(count / resLimit)

    return {
      products: productsWithFullVariants,
      count,
      totalPages,
      currentPage: page,
    }
  } catch (error) {
    console.error("상품 목록 로드 실패:", error)
    throw error
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
