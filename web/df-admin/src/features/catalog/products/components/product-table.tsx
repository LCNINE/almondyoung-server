import { useState } from "react"
import { useProducts, useBulkDeleteProducts } from "@/lib/services/catalog/products"
import { useDataTable } from "@/hooks/use-data-table"
import { useProductTableColumns } from "../hooks/use-product-table-columns"
import { useProductTableFilters } from "../hooks/use-product-table-filters"
import { useProductTableQuery } from "../hooks/use-product-table-query"
import { DataTable } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

const PAGE_SIZE = 20

export function ProductTable() {
  const { searchParams: query } = useProductTableQuery({ pageSize: PAGE_SIZE })
  const { data, isLoading, isFetching } = useProducts(query)
  const columns = useProductTableColumns()
  const filters = useProductTableFilters()

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.masterId,
    enableRowSelection: true,
  })

  const selectedRows = table.getSelectedRowModel().rows
  const selectedIds = selectedRows.map((r) => r.original.masterId)

  const bulkDelete = useBulkDeleteProducts()
  const [deleting, setDeleting] = useState(false)

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return
    setDeleting(true)
    try {
      await bulkDelete.mutateAsync(selectedIds)
      toast.success(`${selectedIds.length}개 상품 삭제됨`)
      table.resetRowSelection()
    } catch {
      toast.error("삭제 실패")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-2 border-b bg-muted/50 p-3">
          <span className="text-sm text-muted-foreground">
            {selectedIds.length}개 선택됨
          </span>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleBulkDelete}
            disabled={deleting}
          >
            삭제
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => table.resetRowSelection()}
          >
            선택 해제
          </Button>
        </div>
      )}
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
        navigateTo={(row) => `/catalog/products/${row.original.masterId}`}
        noRecords={{ message: "상품이 없습니다." }}
      />
    </div>
  )
}
