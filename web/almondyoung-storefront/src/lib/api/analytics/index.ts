import { api } from "../api"
import { ProductRankingDto } from "@lib/types/dto/analytics"

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
