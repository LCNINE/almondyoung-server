import { api } from "../api"
import type {
  ProductRankingDto,
  FrequentlyPurchasedDto,
} from "@lib/types/dto/analytics"

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
 * 자주 산 상품 목록 조회
 * @param limit 조회할 최대 개수 (기본값: 20, 최대: 100)
 */
export const getFrequentlyPurchased = async (
  limit: number = 20
): Promise<FrequentlyPurchasedDto[]> => {
  const params = new URLSearchParams()
  if (limit) params.set("limit", String(limit))

  const queryString = params.toString()

  const data = await api<FrequentlyPurchasedDto[]>(
    "anly",
    `/frequently-purchased${queryString ? `?${queryString}` : ""}`,
    {
      method: "GET",
      withAuth: true,
      next: {
        tags: ["frequently-purchased"],
      },
    }
  )

  return data
}
