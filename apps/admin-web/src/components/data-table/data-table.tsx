'use client';

import { type Row, type RowData, type Table } from '@tanstack/react-table';
import { DataTableQuery } from './data-table-query';
import { DataTableRoot } from './data-table-root';
import type { Filter } from './data-table-filter/types';

type DataTableProps<TData extends RowData> = {
  table: Table<TData>;
  isLoading?: boolean;
  isFetching?: boolean;
  count?: number;
  pageSize?: number;
  filters?: Filter[];
  orderBy?: { key: string; label: string }[];
  orderByPresetOnly?: boolean;
  search?: boolean;
  navigateTo?: (row: Row<TData>) => string;
  noRecords?: { message: string };
  prefix?: string;
};

export function DataTable<TData extends RowData>({
  table,
  isLoading,
  isFetching,
  count = 0,
  pageSize = 20,
  filters,
  orderBy,
  orderByPresetOnly,
  search,
  navigateTo,
  noRecords,
  prefix,
}: DataTableProps<TData>) {
  return (
    <div>
      <DataTableQuery
        filters={filters}
        orderBy={orderBy}
        orderByPresetOnly={orderByPresetOnly}
        search={search}
        prefix={prefix}
      />
      <DataTableRoot
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        noRecords={noRecords}
        navigateTo={navigateTo}
        pageSize={pageSize}
        count={count}
      />
    </div>
  );
}
