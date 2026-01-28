"use server"

import { sdk } from "@/lib/config/medusa"
import { getAuthHeaders } from "@lib/data/cookies"
import type { ProductsResponseDto } from "@lib/types/dto/medusa"
import type { StoreProduct } from "@medusajs/types"

interface GetProductListParams {
  page?: number
  limit?: number
  categoryId?: string | string[]
  region_id?: string
  handle?: string[] | string
  q?: string // 검색어 파라미터 추가
  order?: string // 정렬 파라미터 (예: "created_at", "-created_at", "title", "-title")
}

// 상품 목록 조회
export const getProductList = async ({
  page = 1,
  limit = 10,
  categoryId,
  region_id,
  handle,
  q,
  order,
}: GetProductListParams): Promise<ProductsResponseDto> => {
  const offset = (page - 1) * limit

  try {
    const authHeaders = await getAuthHeaders()
    const isAuthed = "authorization" in authHeaders
    const headers = isAuthed
      ? { ...authHeaders }
      : {
        ...authHeaders,
        next: {
          tags: ["products", categoryId || "", q || ""],
        },
      }

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
        q, // 검색어 전달
        order, // 정렬 (예: "-created_at" = 최신순)
        fields:
          "variants.*,+variants.metadata,+variants.prices.*,+variants.calculated_price,+variants.calculated_price_incl_tax,+variants.original_price,+variants.original_price_incl_tax,+categories,+metadata,+tags",
        region_id: region_id,
      },
      {
        next: {
          tags: [
            "products",
            Array.isArray(categoryId)
              ? categoryId.join(",")
              : categoryId || "",
          ],
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
  // salesChannelId?: string | null
): Promise<StoreProduct> => {
  try {
    const authHeaders = await getAuthHeaders()
    const isAuthed = "authorization" in authHeaders
    const headers = {
      ...authHeaders,
    }

    const { product } = await sdk.store.product.retrieve(
      productId,
      {
        fields:
          "variants.*,+variants.metadata,+variants.prices.*,+variants.calculated_price,+variants.calculated_price_incl_tax,+variants.original_price,+variants.original_price_incl_tax,+variants.price_type,+variants.currency_code",
        region_id: regionId,
      },
      {
        ...headers,
        cache: isAuthed ? "no-store" : undefined,
      }
    )

    console.log("product::", product)

    return product
  } catch (error) {
    console.error("상품 상세 조회 실패:", error)
    throw error
  }
}
