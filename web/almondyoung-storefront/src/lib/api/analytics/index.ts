import { api } from "../api"
import { ProductOrderMetricDto } from "@lib/types/dto/analytics"

export const getBestOrderMetricsByCategory = async (
  categoryId?: string
): Promise<ProductOrderMetricDto[]> => {
  const data = await api<ProductOrderMetricDto[]>(
    "anly",
    `/best-product?categoryId=${categoryId}`,
    {
      method: "GET",
      withAuth: false,
      next: {
        tags: [ categoryId || ""],
      },
    }
  )

  return data
}
