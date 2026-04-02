type ReviewRatingFilter = "1" | "2" | "3" | "4" | "5" | "positive" | "negative"

type ReviewSortOption = "latest" | "oldest" | "rating_high" | "rating_low"

type QnaSortOption = "latest" | "oldest"

type ProductSortOption =
  | "created_at"
  | "price_asc"
  | "price_desc"
  | "sales_desc"

// (/store/products-sorted) 정렬 타입
type ProductSortBy = "min_price" | "max_price" | "sales_count"
type ProductSortOrder = "asc" | "desc"

export type {
  ReviewRatingFilter,
  ReviewSortOption,
  QnaSortOption,
  ProductSortOption,
  ProductSortBy,
  ProductSortOrder,
}
