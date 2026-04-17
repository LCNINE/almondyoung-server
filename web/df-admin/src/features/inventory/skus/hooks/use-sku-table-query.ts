import { useQueryParams } from "@/hooks/use-query-params"
import type {
  SkuAdvancedQuery,
  StockDisplayMode,
  StockType,
} from "@/lib/types/inventory"

type UseSkuTableQueryProps = {
  prefix?: string
  pageSize?: number
}

const STOCK_TYPES: StockType[] = [
  "physical",
  "infinite",
  "drop_shipped",
  "consignment",
]

const DISPLAY_MODES: StockDisplayMode[] = [
  "all",
  "below_safety",
  "with_stock",
  "out_of_stock",
]

export function useSkuTableQuery({
  prefix,
  pageSize = 20,
}: UseSkuTableQueryProps = {}) {
  const raw = useQueryParams(
    ["page", "q", "stockType", "displayMode", "barcode", "sort", "order"],
    prefix,
  )

  const { page, q, stockType, displayMode, barcode, sort, order } = raw

  const pageNum = page ? Math.max(1, Number(page)) : 1
  const stockTypeTyped = STOCK_TYPES.includes(stockType as StockType)
    ? (stockType as StockType)
    : undefined
  const displayModeTyped = DISPLAY_MODES.includes(
    displayMode as StockDisplayMode,
  )
    ? (displayMode as StockDisplayMode)
    : undefined

  const sortByTyped =
    sort === "name" ||
    sort === "code" ||
    sort === "createdAt" ||
    sort === "updatedAt" ||
    sort === "safetyStock"
      ? sort
      : undefined
  const sortOrderTyped =
    order === "asc" || order === "desc" ? order : undefined

  const searchParams: SkuAdvancedQuery = {
    limit: pageSize,
    offset: (pageNum - 1) * pageSize,
    search: q || undefined,
    stockType: stockTypeTyped,
    displayMode: displayModeTyped,
    barcode: barcode || undefined,
    sortBy: sortByTyped,
    sortOrder: sortOrderTyped,
  }

  return { searchParams, raw }
}
