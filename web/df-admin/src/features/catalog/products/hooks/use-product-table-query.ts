import { useQueryParams } from "@/hooks/use-query-params"
import type { ProductsQuery } from "@/lib/types/catalog"

type UseProductTableQueryProps = {
  prefix?: string
  pageSize?: number
}

export function useProductTableQuery({
  prefix,
  pageSize = 20,
}: UseProductTableQueryProps = {}) {
  const queryObject = useQueryParams(
    ["page", "q", "categoryId", "brand", "mode", "sort", "order"],
    prefix,
  )

  const { page, q, categoryId, brand, mode, sort, order } = queryObject

  const searchParams: ProductsQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    name: q,
    categoryId,
    brand,
    mode: mode ?? "active",
    sort,
    order,
  }

  return { searchParams, raw: queryObject }
}
