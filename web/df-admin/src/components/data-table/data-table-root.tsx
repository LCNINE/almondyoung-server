import {
  flexRender,
  type Row,
  type RowData,
  type Table as TanstackTable,
} from "@tanstack/react-table"
import { useNavigate } from "react-router-dom"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTablePagination } from "./data-table-pagination"

type DataTableRootProps<TData extends RowData> = {
  table: TanstackTable<TData>
  isLoading?: boolean
  isFetching?: boolean
  noRecords?: { message: string }
  navigateTo?: (row: Row<TData>) => string
  pageSize: number
  count: number
}

export function DataTableRoot<TData extends RowData>({
  table,
  isLoading,
  isFetching,
  noRecords,
  navigateTo,
  pageSize,
  count,
}: DataTableRootProps<TData>) {
  const navigate = useNavigate()

  const { pageIndex } = table.getState().pagination
  const pageCount = table.getPageCount()
  const rows = table.getRowModel().rows

  return (
    <div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="bg-muted">
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="whitespace-nowrap">
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading || isFetching ? (
            Array.from({ length: pageSize }).map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {table.getAllColumns().map((col) => (
                  <TableCell key={col.id}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={table.getAllColumns().length}
                className="py-8 text-center text-muted-foreground"
              >
                {noRecords?.message ?? "데이터가 없습니다."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const href = navigateTo ? navigateTo(row) : undefined
              return (
                <TableRow
                  key={row.id}
                  className={href ? "cursor-pointer" : ""}
                  onClick={href ? () => navigate(href) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="whitespace-nowrap">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
      <DataTablePagination
        count={count}
        pageSize={pageSize}
        pageIndex={pageIndex}
        pageCount={pageCount}
        canPreviousPage={table.getCanPreviousPage()}
        canNextPage={table.getCanNextPage()}
        previousPage={() => table.previousPage()}
        nextPage={() => table.nextPage()}
        goPage={(idx) => table.setPageIndex(idx)}
      />
    </div>
  )
}
