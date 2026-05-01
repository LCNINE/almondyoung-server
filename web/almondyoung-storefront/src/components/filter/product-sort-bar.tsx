"use client"

interface SortOption {
  key: string
  label: string
}

interface ProductSortBarProps {
  categoryName: string
  total: number
  currentSort?: string
  sortOptions?: SortOption[]
  pageSizeOptions?: { value: string; label: string }[]
  onSortChange?: (sort: string) => void
}

export function ProductSortBar({
  categoryName,
  total,
  currentSort = "popular",
  sortOptions = [
    { key: "popular", label: "아몬드영 랭킹 순" },
    { key: "priceAsc", label: "낮은가격순" },
    { key: "priceDesc", label: "높은가격순" },
    { key: "sales", label: "판매량순" },
    { key: "new", label: "최신순" },
  ],
  pageSizeOptions = [
    { value: "60", label: "60개씩 보기" },
    { value: "40", label: "40개씩 보기" },
    { value: "20", label: "20개씩 보기" },
  ],
  onSortChange,
}: ProductSortBarProps) {
  return (
    <div className="mb-6 flex max-w-[1002px] flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
      <div className="text-muted-foreground text-sm">
        {categoryName} 총{" "}
        <span className="text-foreground font-semibold">{total}</span>개 상품
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 md:block">
          <div className="flex gap-2">
            <span className="text-muted-foreground text-sm">정렬:</span>
            {sortOptions.map((option) => (
              <button
                key={option.key}
                onClick={() => onSortChange?.(option.key)}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  currentSort === option.key
                    ? "bg-orange-500 text-white"
                    : "bg-muted text-gray-700 hover:bg-gray-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">보기:</span>
          <select className="rounded border border-gray-300 px-2 py-1 text-sm">
            {pageSizeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
