import { DataTableFilter } from "./data-table-filter/data-table-filter"
import { DataTableOrderBy } from "./data-table-order-by"
import { DataTableSearch } from "./data-table-search"
import type { Filter } from "./data-table-filter/types"

type DataTableQueryProps = {
  filters?: Filter[]
  orderBy?: { key: string; label: string }[]
  search?: boolean
  prefix?: string
}

export function DataTableQuery({
  filters,
  orderBy,
  search,
  prefix,
}: DataTableQueryProps) {
  const hasFilters = filters && filters.length > 0
  const hasOrderBy = orderBy && orderBy.length > 0

  if (!hasFilters && !hasOrderBy && !search) return null

  return (
    <div className="flex items-center justify-between gap-4 p-2">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {hasFilters && <DataTableFilter filters={filters} prefix={prefix} />}
      </div>
      <div className="flex items-center gap-2">
        {search && <DataTableSearch prefix={prefix} />}
        {hasOrderBy && <DataTableOrderBy orderBy={orderBy} prefix={prefix} />}
      </div>
    </div>
  )
}
