'use client'

import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type Table,
} from '@tanstack/react-table'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'

type UseDataTableProps<TData extends RowData> = {
  data: TData[]
  columns: ColumnDef<TData, any>[]
  count?: number
  pageSize?: number
  enablePagination?: boolean
  getRowId?: (row: TData) => string
  enableRowSelection?: boolean
  prefix?: string
}

export function useDataTable<TData extends RowData>({
  data,
  columns,
  count = 0,
  pageSize = 20,
  getRowId,
  enableRowSelection = false,
  prefix,
}: UseDataTableProps<TData>): { table: Table<TData> } {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const prefixKey = (key: string) => (prefix ? `${prefix}_${key}` : key)

  const pageParam = searchParams.get(prefixKey('page'))
  const currentPage = pageParam ? Number(pageParam) : 1
  const pageIndex = currentPage - 1
  const pageCount = Math.max(1, Math.ceil(count / pageSize))

  const onPaginationChange = useCallback(
    (updater: PaginationState | ((prev: PaginationState) => PaginationState)) => {
      const prev: PaginationState = { pageIndex, pageSize }
      const next = typeof updater === 'function' ? updater(prev) : updater
      const newPage = next.pageIndex + 1
      const params = new URLSearchParams(searchParams.toString())
      const pKey = prefixKey('page')
      if (newPage <= 1) {
        params.delete(pKey)
      } else {
        params.set(pKey, String(newPage))
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageIndex, pageSize, searchParams.toString(), pathname, prefix],
  )

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount,
    state: {
      pagination: { pageIndex, pageSize },
      ...(enableRowSelection && { rowSelection }),
    },
    onPaginationChange,
    ...(enableRowSelection && { onRowSelectionChange: setRowSelection }),
    ...(getRowId && { getRowId }),
  })

  return { table }
}
