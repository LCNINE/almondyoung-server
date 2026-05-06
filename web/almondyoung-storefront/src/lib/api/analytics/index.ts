import { api } from "../api"
import type { FrequentlyPurchasedDto } from "@lib/types/dto/analytics"
import type { PaginatedResponseDto } from "@lib/types/common/pagination"

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
