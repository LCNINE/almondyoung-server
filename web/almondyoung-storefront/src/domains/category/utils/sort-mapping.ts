import type { ProductSortBy, ProductSortOrder } from "@/lib/types/common/filter"
import type { SortOptions } from "@/domains/category/components/refinement-list/sort-products"

export const DEFAULT_CATEGORY_SORT: SortOptions = "sales_desc"

const CATEGORY_SORT_OPTIONS = new Set<SortOptions>([
  "sales_desc",
  "review_count_desc",
  "price_asc",
  "price_desc",
  "created_at",
])

export function normalizeCategorySort(sortBy?: string): SortOptions {
  if (sortBy && CATEGORY_SORT_OPTIONS.has(sortBy as SortOptions)) {
    return sortBy as SortOptions
  }

  return DEFAULT_CATEGORY_SORT
}

/**
 * 정렬 옵션이 서버의 정렬 엔드포인트(/store/products-sorted)를 타야 하는지 여부.
 * created_at(최신순)은 일반 listProducts 로 처리한다.
 */
export function isSortedOption(sortBy?: SortOptions): boolean {
  return (
    sortBy === "price_asc" ||
    sortBy === "price_desc" ||
    sortBy === "sales_desc" ||
    sortBy === "review_count_desc"
  )
}

/**
 * SortOptions → listProductsSorted 의 sortBy/order 파라미터로 변환.
 * 서버(첫 페이지)와 클라이언트(다음 페이지)가 동일한 규칙을 쓰도록 한 곳에서 관리한다.
 */
export function mapSortParams(sortBy: SortOptions): {
  sortBy: ProductSortBy
  order: ProductSortOrder
} {
  const mappedSortBy: ProductSortBy =
    sortBy === "price_asc"
      ? "min_price"
      : sortBy === "price_desc"
        ? "max_price"
        : sortBy === "review_count_desc"
          ? "review_count"
          : "sales_count"

  const order: ProductSortOrder = sortBy === "price_asc" ? "asc" : "desc"

  return { sortBy: mappedSortBy, order }
}
