'use client'

import { flexRender, type Row, type RowData, type Table as TanstackTable } from '@tanstack/react-table'
import { useRouter } from 'next/navigation'
import { Table } from '@/components/admin-ui-experimental/common/table/table'
import { Skeleton } from '@/components/ui/skeleton'

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
  const router = useRouter()

  const { pageIndex } = table.getState().pagination
  const pageCount = table.getPageCount()

  const rows = table.getRowModel().rows

  return (
    <div>
      <Table>
        <Table.Header>
          {table.getHeaderGroups().map((headerGroup) => (
            <Table.Row key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <Table.Head key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </Table.Head>
              ))}
            </Table.Row>
          ))}
        </Table.Header>
        <Table.Body>
          {(isLoading || isFetching) ? (
            Array.from({ length: pageSize }).map((_, i) => (
              <Table.Row key={`skeleton-${i}`}>
                {table.getAllColumns().map((col) => (
                  <Table.Cell key={col.id}>
                    <Skeleton className="h-4 w-full" />
                  </Table.Cell>
                ))}
              </Table.Row>
            ))
          ) : rows.length === 0 ? (
            <Table.Row>
              <Table.Cell
                colSpan={table.getAllColumns().length}
                className="py-8 text-center text-muted-foreground"
              >
                {noRecords?.message ?? '데이터가 없습니다.'}
              </Table.Cell>
            </Table.Row>
          ) : (
            rows.map((row) => {
              const href = navigateTo ? navigateTo(row) : undefined
              return (
                <Table.Row
                  key={row.id}
                  className={href ? 'cursor-pointer' : ''}
                  onClick={href ? () => router.push(href) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <Table.Cell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </Table.Cell>
                  ))}
                </Table.Row>
              )
            })
          )}
        </Table.Body>
      </Table>
      <Table.Pagination
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
