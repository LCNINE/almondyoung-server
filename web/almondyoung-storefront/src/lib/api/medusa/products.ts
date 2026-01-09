"use server"

import { sdk } from "@/lib/config/medusa"
import type { ProductsResponseDto } from "@lib/types/dto/medusa"

import type { StoreProduct } from "@medusajs/types"

// 상품 목록 조회
export const getProductList = async (
  page: number = 1,
  limit: number = 10,
  categoryId?: string
): Promise<ProductsResponseDto> => {
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
        fields: "*variants,+categories,+metadata,+tags",
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
  productId: string
): Promise<StoreProduct> => {
  try {
    const { product } = await sdk.store.product.retrieve(productId, {
      fields: "*variants.calculated_price",
    })

    return product
  } catch (error) {
    console.error("상품 상세 조회 실패:", error)
    throw error
  }
}
