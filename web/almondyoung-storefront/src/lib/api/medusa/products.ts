"use server"

import { sdk } from "@/lib/config/medusa"
import type { ProductsResponseDto } from "@lib/types/dto/medusa"
import type { StoreProduct } from "@medusajs/types"

interface GetProductListParams {
  page?: number
  limit?: number
  categoryId?: string
  region_id?: string
  handle?: string[] | string
}

// 상품 목록 조회
export const getProductList = async ({
  page = 1,
  limit = 10,
  categoryId,
  region_id,
  handle,
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
        fields:
          "*variants.calculated_price,+categories,+metadata,+tags,+variants.prices.*",
        region_id: region_id,
      },
      {
        next: {
          tags: ["products", categoryId || ""],
        },
      }
    )

    const totalPages = Math.ceil(count / resLimit)

    return {
      products,
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
): Promise<StoreProduct> => {
  try {
    const { product } = await sdk.store.product.retrieve(productId, {
      fields: "*variants.calculated_price",
      region_id: regionId,
    })

    return product
  } catch (error) {
    console.error("상품 상세 조회 실패:", error)
    throw error
  }
}
