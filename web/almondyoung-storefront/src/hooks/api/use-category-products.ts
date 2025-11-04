import useSWR from "swr"
import { getProductsByCategoryService } from "@lib/services/pim/products/getProductListService"
import { readCache } from "@lib/services/pim/products/getProductListService"

type Opts = { limit?: number; sort?: "popular" | "new" | "price" }

export function useCategoryProducts(categoryId?: string, opts: Opts = {}) {
  const { limit = 50, sort = "popular" } = opts
  const key = categoryId ? ["category-products", categoryId, sort, limit] as const : null

  const fallback = (categoryId && typeof window !== "undefined")
    ? readCache(categoryId, sort, limit)
    : null

  const fetcher = async (_key: typeof key) =>
    getProductsByCategoryService(_key![1], { page: 1, limit, sort })

  return useSWR(key, fetcher, {
    keepPreviousData: true, // 이전 데이터 유지하여 부드러운 전환
    fallbackData: fallback ? { items: fallback.items, total: fallback.total, page: 1, limit } : undefined,
    revalidateOnFocus: false,
    revalidateIfStale: false, // 캐시된 데이터가 있으면 재검증하지 않음
    dedupingInterval: 60_000, // 1분으로 연장
    revalidateOnMount: true, // 마운트 시에만 재검증
  })
}