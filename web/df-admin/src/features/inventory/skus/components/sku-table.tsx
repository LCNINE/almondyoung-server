import { useSkus } from "@/lib/services/inventory/skus"
import { useDataTable } from "@/hooks/use-data-table"
import { DataTable } from "@/components/data-table"
import { useSkuTableColumns } from "../hooks/use-sku-table-columns"
import { useSkuTableFilters } from "../hooks/use-sku-table-filters"
import { useSkuTableQuery } from "../hooks/use-sku-table-query"

const PAGE_SIZE = 20

export function SkuTable() {
  const { searchParams: query } = useSkuTableQuery({ pageSize: PAGE_SIZE })
  const { data, isLoading, isFetching } = useSkus(query)
  const columns = useSkuTableColumns()
  const filters = useSkuTableFilters()

  const { table } = useDataTable({
    data: data?.items ?? [],
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
      orderBy={[
        { key: "name", label: "이름" },
        { key: "code", label: "SKU 코드" },
        { key: "updatedAt", label: "수정일" },
        { key: "createdAt", label: "생성일" },
        { key: "safetyStock", label: "안전재고" },
      ]}
      search
      navigateTo={(row) => `/inventory/skus/${row.original.id}`}
      noRecords={{ message: "등록된 재고상품이 없습니다." }}
    />
  )
}
