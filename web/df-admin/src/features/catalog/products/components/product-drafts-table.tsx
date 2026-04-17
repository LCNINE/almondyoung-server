import { useProductDrafts } from "@/lib/services/catalog/products"
import { useDataTable } from "@/hooks/use-data-table"
import { useProductTableColumns } from "../hooks/use-product-table-columns"
import { useProductTableFilters } from "../hooks/use-product-table-filters"
import { useProductTableQuery } from "../hooks/use-product-table-query"
import { DataTable } from "@/components/data-table"

const PAGE_SIZE = 20

export function ProductDraftsTable() {
  const { searchParams: query } = useProductTableQuery({ pageSize: PAGE_SIZE })
  const { data, isLoading, isFetching } = useProductDrafts(query)
  const columns = useProductTableColumns()
  const filters = useProductTableFilters()

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.versionId,
  })

  return (
    <div>
      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={data?.total ?? 0}
        pageSize={PAGE_SIZE}
        filters={filters}
        orderBy={[
          { key: "name", label: "상품명" },
          { key: "createdAt", label: "생성일" },
          { key: "brand", label: "브랜드" },
        ]}
        search
        navigateTo={(row) =>
          `/catalog/products/${row.original.masterId}/versions/${row.original.versionId}`
        }
        noRecords={{ message: "작성중인 상품이 없습니다." }}
      />
    </div>
  )
}
