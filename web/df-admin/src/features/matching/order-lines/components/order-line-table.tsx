import { DataTable } from "@/components/data-table"
import { useDataTable } from "@/hooks/use-data-table"
import { useOrderLines } from "@/lib/services/matching/order-lines"
import { useOrderLineTableColumns } from "../hooks/use-order-line-table-columns"
import { useOrderLineTableFilters } from "../hooks/use-order-line-table-filters"
import { useOrderLineTableQuery } from "../hooks/use-order-line-table-query"

const PAGE_SIZE = 20

export function OrderLineTable() {
  const { searchParams: query } = useOrderLineTableQuery({
    pageSize: PAGE_SIZE,
  })
  const { data, isLoading, isFetching } = useOrderLines(query)
  const columns = useOrderLineTableColumns()
  const filters = useOrderLineTableFilters()

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total ?? 0,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  })

  return (
    <DataTable
      table={table}
      isLoading={isLoading}
      isFetching={isFetching}
      count={data?.total ?? 0}
      pageSize={PAGE_SIZE}
      filters={filters}
      search
      noRecords={{ message: "조회된 주문 매칭 건이 없습니다." }}
    />
  )
}
