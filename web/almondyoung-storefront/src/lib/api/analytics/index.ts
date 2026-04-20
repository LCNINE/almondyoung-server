import { api } from "../api"
import type {
  ProductRankingDto,
  FrequentlyPurchasedDto,
} from "@lib/types/dto/analytics"
import type { PaginatedResponseDto } from "@lib/types/common/pagination"

type BestProductRankingsParams = {
  categoryId?: string
  limit?: number
}

/**
 * 베스트 상품 랭킹 조회
 * @returns masterId는 Medusa 상품의 handle 값
 */
export const getBestProductRankings = async ({
  categoryId,
  limit,
}: BestProductRankingsParams = {}): Promise<ProductRankingDto[]> => {
  const params = new URLSearchParams()
  if (categoryId) params.set("categoryId", categoryId)
  if (limit) params.set("limit", String(limit))

  const queryString = params.toString()

  const data = await api<ProductRankingDto[]>(
    "anly",
    `/best-product${queryString ? `?${queryString}` : ""}`,
    {
      method: "GET",
      withAuth: false,
      next: {
        tags: ["best-products", categoryId || "all"],
      },
    }
  )

  return data
}

/**
 * 자주 산 상품 목록 조회 (페이지네이션)
 */
export const getFrequentlyPurchased = async (
  page: number = 1,
  limit: number = 12
): Promise<PaginatedResponseDto<FrequentlyPurchasedDto>> => {
  const params = new URLSearchParams()
  params.set("page", String(page))
  params.set("limit", String(limit))

  return await api<PaginatedResponseDto<FrequentlyPurchasedDto>>(
    "anly",
    `/frequently-purchased?${params.toString()}`,
    {
      method: "GET",
      withAuth: true,
      next: {
        tags: ["frequently-purchased", `page-${page}`, `limit-${limit}`],
      },
    }
  )
}
