'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useReturnsTableColumns } from '@/hooks/table/columns/use-returns-table-columns';
import { useReturnsTableFilters } from '@/hooks/table/filters/use-returns-table-filters';
import { useReturnsTableQuery } from '@/hooks/table/query/use-returns-table-query';
import { useReturns } from '@/lib/services/inventory';
import type { ReturnDto } from '@/lib/types/dto/inventory';
import { ReturnDetailDrawer } from '../return-detail-drawer';

const PAGE_SIZE = 20;

export function ReturnsTable() {
  const { searchParams } = useReturnsTableQuery();
  const { data, isLoading, isFetching } = useReturns(searchParams);

  const [detailRow, setDetailRow] = useState<ReturnDto | null>(null);

  const columns = useReturnsTableColumns({ onDetail: setDetailRow });
  const filters = useReturnsTableFilters();

  const rows = data?.returns ?? [];
  const total = data?.total ?? 0;

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <>
      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        noRecords={{ message: '회수 내역이 없습니다.' }}
      />

      <ReturnDetailDrawer
        row={detailRow}
        open={!!detailRow}
        onOpenChange={(open) => {
          if (!open) setDetailRow(null);
        }}
      />
    </>
  );
}
